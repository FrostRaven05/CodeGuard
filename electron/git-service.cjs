const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIFF_LIMIT = 700_000;
const MAX_OUTPUT = 12 * 1024 * 1024;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

class WorkbenchError extends Error {
  constructor(message, code = 'GIT_ERROR', details = '') {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function runGit(cwd, args, { input, allowFailure = false, timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };
    for (const name of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    ])
      delete env[name];
    const child = spawn(
      'git',
      [
        '--no-pager',
        '--literal-pathspecs',
        '-c',
        'core.quotepath=false',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'color.ui=false',
        ...args,
      ],
      { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const stdout = [],
      stderr = [];
    let size = 0,
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new WorkbenchError('Git 操作等待超时，请刷新仓库核对实际状态。', 'GIT_TIMEOUT'));
    }, timeout);
    const collect = (parts) => (buffer) => {
      size += buffer.length;
      if (size > MAX_OUTPUT) {
        child.kill();
        finish(new WorkbenchError('Git 输出过大，无法完整显示。', 'OUTPUT_LIMIT'));
      } else parts.push(buffer);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', (error) =>
      finish(
        new WorkbenchError(
          error.code === 'ENOENT'
            ? '没有找到 Git，请安装 Git 并重新打开 CodeGuard。'
            : error.message,
          'GIT_UNAVAILABLE',
        ),
      ),
    );
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code !== 0 && !allowFailure) {
        const details = result.stderr.trim() || result.stdout.trim();
        if (/^fatal: detected dubious ownership in repository at /m.test(result.stderr)) {
          finish(
            new WorkbenchError(
              'Git 检测到仓库所有者与当前账户不同。确认这是你信任的仓库后，请按“错误详情”中的命令为该目录添加信任，再重新打开。',
              'DUBIOUS_OWNERSHIP',
              details,
            ),
          );
        } else
          finish(new WorkbenchError(details || `Git 操作失败（${code}）。`, 'GIT_ERROR', details));
      } else finish(null, result);
    });
    child.stdin.end(input === undefined ? undefined : input);
  });
}

function parseStatus(raw) {
  const result = {
    branch: '',
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
  };
  const records = raw.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('# branch.oid '))
      result.head = record.slice(13) === '(initial)' ? null : record.slice(13);
    else if (record.startsWith('# branch.head ')) {
      result.branch = record.slice(14);
      result.detached = result.branch === '(detached)';
    } else if (record.startsWith('# branch.upstream ')) result.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) {
      const values = record.slice(12).split(' ');
      result.ahead = Number(values[0].slice(1));
      result.behind = Number(values[1].slice(1));
    } else if (record.startsWith('? ')) {
      result.files.push({
        path: record.slice(2),
        indexStatus: '.',
        worktreeStatus: '?',
        untracked: true,
        conflict: false,
        submodule: false,
      });
    } else if (['1 ', '2 ', 'u '].some((prefix) => record.startsWith(prefix))) {
      const fields = record.split(' '),
        type = fields[0];
      const file = {
        path: fields.slice(type === '1' ? 8 : type === '2' ? 9 : 10).join(' '),
        indexStatus: fields[1][0],
        worktreeStatus: fields[1][1],
        untracked: false,
        conflict: type === 'u',
        submodule: fields[2].startsWith('S'),
      };
      if (type === '2') file.previousPath = records[++i];
      result.files.push(file);
    }
  }
  return result;
}

function parseNameStatus(raw) {
  const fields = raw.split('\0'),
    files = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    if (status.startsWith('R') || status.startsWith('C'))
      files.push({ status: status[0], previousPath: fields[i++], path: fields[i++] });
    else files.push({ status: status[0], path: fields[i++] });
  }
  return files;
}

function parseHistory(raw) {
  const fields = raw.split('\0'),
    commits = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const sha = fields[i].trim();
    if (!sha) continue;
    commits.push({
      hash: sha,
      parents: fields[i + 1].split(' ').filter(Boolean),
      refs: fields[i + 2].split(', ').filter(Boolean),
      author: fields[i + 3],
      date: fields[i + 4],
      subject: fields[i + 5],
    });
  }
  return commits;
}

class GitService {
  constructor(storageDirectory) {
    this.storageDirectory = storageDirectory;
    fs.mkdirSync(storageDirectory, { recursive: true });
    this.storageFile = path.join(storageDirectory, 'workspace.json');
    this.workspace = { repositories: [], activeRepositoryId: null, drafts: {} };
    this.loadWarning = null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      if (
        !Array.isArray(saved.repositories) ||
        typeof saved.drafts !== 'object' ||
        saved.drafts === null
      )
        throw new Error('Invalid workspace');
      this.workspace = { ...this.workspace, ...saved };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const backup = `${this.storageFile}.backup-${Date.now()}`;
        try {
          fs.copyFileSync(this.storageFile, backup);
        } catch {}
        this.loadWarning = '本地设置无法读取，原文件已尽可能保留为备份。请重新添加仓库。';
      }
    }
    this.queues = new Map();
    this.previews = new Map();
  }

  persist() {
    const temporary = `${this.storageFile}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.workspace, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.storageFile);
  }

  getWorkspace() {
    return structuredClone({ ...this.workspace, warning: this.loadWarning });
  }

  repository(id) {
    const repository = this.workspace.repositories.find((item) => item.id === id);
    if (!repository) throw new WorkbenchError('请先添加并选择仓库。', 'REPOSITORY_NOT_FOUND');
    return repository;
  }

  async addRepository(directory) {
    if (typeof directory !== 'string' || !directory.trim())
      throw new WorkbenchError('请选择仓库目录。', 'INVALID_PATH');
    let location;
    try {
      location = fs.realpathSync(directory);
    } catch {
      throw new WorkbenchError('目录不存在或无法访问。', 'INVALID_PATH');
    }
    const result = await runGit(location, ['rev-parse', '--show-toplevel']);
    const root = fs.realpathSync(result.stdout.trim());
    const id = hash(process.platform === 'win32' ? root.toLowerCase() : root).slice(0, 20);
    let repository = this.workspace.repositories.find((item) => item.id === id);
    if (!repository) {
      const gitDir = (await runGit(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
      repository = { id, root, gitDir, name: path.basename(root) || root };
      this.workspace.repositories.push(repository);
    }
    this.workspace.activeRepositoryId = id;
    this.persist();
    return structuredClone(repository);
  }

  selectRepository(id) {
    this.repository(id);
    this.workspace.activeRepositoryId = id;
    this.persist();
    return this.getWorkspace();
  }

  removeRepository(id) {
    this.repository(id);
    this.workspace.repositories = this.workspace.repositories.filter((item) => item.id !== id);
    if (this.workspace.activeRepositoryId === id)
      this.workspace.activeRepositoryId = this.workspace.repositories[0]?.id || null;
    delete this.workspace.drafts[id];
    this.persist();
    return this.getWorkspace();
  }

  saveDraft(id, message) {
    this.repository(id);
    if (typeof message !== 'string' || message.length > 200_000)
      throw new WorkbenchError('提交说明过长或格式无效。', 'INVALID_MESSAGE');
    this.workspace.drafts[id] = message;
    this.persist();
  }

  serialize(id, work) {
    const next = (this.queues.get(id) || Promise.resolve()).catch(() => {}).then(work);
    this.queues.set(
      id,
      next.catch(() => {}),
    );
    return next;
  }

  async getState(id) {
    const repository = this.repository(id);
    const raw = (
      await runGit(repository.root, [
        'status',
        '--porcelain=v2',
        '-z',
        '--branch',
        '--untracked-files=all',
      ])
    ).stdout;
    const state = parseStatus(raw);
    const branchesRaw = (
      await runGit(repository.root, [
        'for-each-ref',
        '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)',
        'refs/heads',
        'refs/remotes',
      ])
    ).stdout;
    const branches = branchesRaw
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, name, sha, marker] = line.split('\0');
        return {
          name,
          hash: sha,
          current: marker === '*',
          remote: ref.startsWith('refs/remotes/'),
        };
      });
    const operation =
      fs.existsSync(path.join(repository.gitDir, 'rebase-merge')) ||
      fs.existsSync(path.join(repository.gitDir, 'rebase-apply'))
        ? 'rebase'
        : fs.existsSync(path.join(repository.gitDir, 'MERGE_HEAD'))
          ? 'merge'
          : fs.existsSync(path.join(repository.gitDir, 'CHERRY_PICK_HEAD'))
            ? 'cherry-pick'
            : fs.existsSync(path.join(repository.gitDir, 'REVERT_HEAD'))
              ? 'revert'
              : null;
    let indexBytes = Buffer.alloc(0);
    try {
      indexBytes = fs.readFileSync(path.join(repository.gitDir, 'index'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const indexRevision = hash(
      Buffer.concat([Buffer.from(`${state.head}:${state.branch}:`), indexBytes]),
    );
    const stats = state.files.map((file) => {
      try {
        const stat = fs.lstatSync(this.absolutePath(repository, file.path));
        return `${file.path}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return `${file.path}:missing`;
      }
    });
    return {
      ...state,
      repositoryId: id,
      branches,
      operation,
      locked: fs.existsSync(path.join(repository.gitDir, 'index.lock')),
      indexRevision,
      revision: hash(`${raw}:${indexRevision}:${stats.join('|')}`),
    };
  }

  absolutePath(repository, relativePath) {
    if (
      typeof relativePath !== 'string' ||
      !relativePath ||
      relativePath.includes('\0') ||
      path.isAbsolute(relativePath)
    )
      throw new WorkbenchError('文件路径无效。', 'INVALID_PATH');
    const absolute = path.resolve(repository.root, relativePath);
    const relative = path.relative(repository.root, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new WorkbenchError('文件路径超出所选仓库。', 'INVALID_PATH');
    return absolute;
  }

  async changeStaging(id, relativePath, action) {
    return this.serialize(id, async () => {
      const repository = this.repository(id);
      this.absolutePath(repository, relativePath);
      const state = await this.getState(id);
      const file = state.files.find((item) => item.path === relativePath);
      if (!file) throw new WorkbenchError('文件状态已变化，请刷新。', 'STALE_STATE');
      const paths = [...new Set([file.path, file.previousPath].filter(Boolean))];
      if (action === 'stage') await runGit(repository.root, ['add', '--', ...paths]);
      else if (action === 'unstage') {
        if (state.head)
          await runGit(repository.root, ['restore', '--staged', '--source=HEAD', '--', ...paths]);
        else await runGit(repository.root, ['update-index', '--force-remove', '--', ...paths]);
      } else throw new WorkbenchError('不支持的暂存操作。', 'INVALID_ACTION');
      return this.getState(id);
    });
  }

  async getDiff(id, { scope, path: relativePath, commit }) {
    const repository = this.repository(id);
    this.absolutePath(repository, relativePath);
    let file, args;
    const flags = [
      '--no-ext-diff',
      '--no-textconv',
      '--color=never',
      '--find-renames',
      '--unified=4',
    ];
    if (scope === 'commit') {
      const detail = await this.getCommit(id, commit);
      file = detail.files.find((item) => item.path === relativePath);
      if (!file) throw new WorkbenchError('所选提交不包含该文件。', 'INVALID_PATH');
      args = detail.commit.parents.length
        ? ['diff', ...flags, detail.commit.parents[0], commit]
        : ['show', '--format=', ...flags, commit];
    } else if (scope === 'index' || scope === 'worktree') {
      const state = await this.getState(id);
      file = state.files.find((item) => item.path === relativePath);
      if (!file) throw new WorkbenchError('文件状态已变化，请刷新。', 'STALE_STATE');
      if (scope === 'worktree' && file.untracked) return this.untrackedDiff(repository, file);
      args = ['diff', ...flags, ...(scope === 'index' ? ['--cached'] : [])];
    } else throw new WorkbenchError('差异范围无效。', 'INVALID_SCOPE');
    const paths = [...new Set([file.previousPath, file.path].filter(Boolean))];
    let text;
    try {
      text = (await runGit(repository.root, [...args, '--', ...paths])).stdout;
    } catch (error) {
      if (error.code === 'OUTPUT_LIMIT')
        return {
          path: relativePath,
          scope,
          text: '',
          truncated: true,
          binary: false,
          notice: '差异超过显示限制，请在编辑器中查看完整文件。',
        };
      throw error;
    }
    const binary = /^Binary files |^GIT binary patch/m.test(text);
    return {
      path: relativePath,
      scope,
      text: text.slice(0, DIFF_LIMIT),
      truncated: text.length > DIFF_LIMIT,
      binary,
      notice:
        text.length > DIFF_LIMIT ? '仅显示部分差异。' : !text ? '该范围内没有文本差异。' : null,
    };
  }

  untrackedDiff(repository, file) {
    const absolute = this.absolutePath(repository, file.path);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() && !stat.isSymbolicLink())
      return {
        path: file.path,
        scope: 'worktree',
        text: '',
        binary: false,
        truncated: false,
        notice: '此条目不是普通文件，无法显示文本差异。',
      };
    if (stat.size > DIFF_LIMIT)
      return {
        path: file.path,
        scope: 'worktree',
        text: '',
        binary: false,
        truncated: true,
        notice: '文件超过显示限制，可暂存后在外部编辑器查看。',
      };
    const buffer = stat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(absolute))
      : fs.readFileSync(absolute);
    if (buffer.subarray(0, 8192).includes(0))
      return {
        path: file.path,
        scope: 'worktree',
        text: '',
        binary: true,
        truncated: false,
        notice: '二进制文件，不显示文本内容。',
      };
    const content = buffer.toString('utf8'),
      lines = content.split('\n');
    if (content.endsWith('\n')) lines.pop();
    const body = content.length
      ? `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n${content.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`
      : '';
    return {
      path: file.path,
      scope: 'worktree',
      text: `diff --git a/${file.path} b/${file.path}\nnew file mode ${stat.isSymbolicLink() ? '120000' : '100644'}\n--- /dev/null\n+++ b/${file.path}\n${body}`,
      binary: false,
      truncated: false,
      notice: null,
    };
  }

  async signature(repository) {
    const tree = (await runGit(repository.root, ['write-tree'])).stdout.trim();
    const head =
      (
        await runGit(repository.root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
      ).stdout.trim() || null;
    const ref =
      (
        await runGit(repository.root, ['symbolic-ref', '--quiet', 'HEAD'], { allowFailure: true })
      ).stdout.trim() || null;
    return { tree, head, ref };
  }

  async captureStagedReview(id) {
    return this.serialize(id, async () => {
      const repository = this.repository(id);
      const state = await this.getState(id);
      if (state.files.some((file) => file.conflict))
        throw new WorkbenchError('请先解决冲突，再评审本次提交。', 'CONFLICTS');
      const signature = await this.signature(repository);
      const base =
        signature.head ||
        (
          await runGit(repository.root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })
        ).stdout.trim();
      const files = parseNameStatus(
        (
          await runGit(repository.root, [
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--find-renames',
            '--name-status',
            '-z',
            base,
            signature.tree,
          ])
        ).stdout,
      );
      if (!files.length) throw new WorkbenchError('请先暂存本次要评审的内容。', 'EMPTY_INDEX');
      const after = await this.signature(repository);
      if (JSON.stringify(after) !== JSON.stringify(signature))
        throw new WorkbenchError('暂存内容或分支已变化，请重新准备评审。', 'STALE_REVIEW');
      return {
        ...signature,
        base,
        repositoryId: id,
        files,
        indexRevision: state.indexRevision,
      };
    });
  }

  async readReviewDiff(snapshot, file, limit) {
    const repository = this.repository(snapshot.repositoryId);
    this.absolutePath(repository, file.path);
    if (file.previousPath) this.absolutePath(repository, file.previousPath);
    for (const [revision, relativePath] of [
      [snapshot.head, file.previousPath || file.path],
      [snapshot.tree, file.path],
    ]) {
      if (!revision) continue;
      const entry = (await runGit(repository.root, ['ls-tree', '-z', revision, '--', relativePath]))
        .stdout;
      if (!entry) continue;
      const mode = entry.split(' ')[0];
      if (!['100644', '100755'].includes(mode)) return { reason: '符号链接、子模块或非普通文件' };
      const size = Number(
        (
          await runGit(repository.root, ['cat-file', '-s', `${revision}:${relativePath}`])
        ).stdout.trim(),
      );
      if (size > limit) return { reason: '文件超过上下文预算' };
      const content = (await runGit(repository.root, ['show', `${revision}:${relativePath}`]))
        .stdout;
      if (content.includes('\0')) return { reason: '二进制文件' };
      if (
        /-----BEGIN [\w ]*PRIVATE KEY-----|(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/i.test(
          content,
        )
      )
        return { reason: '检测到疑似密钥内容' };
    }
    const text = (
      await runGit(repository.root, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        '--no-color',
        '--unified=4',
        snapshot.base,
        snapshot.tree,
        '--',
        file.path,
        ...(file.previousPath ? [file.previousPath] : []),
      ])
    ).stdout;
    if (text.length > limit) return { reason: '差异超过上下文预算' };
    if (/^Binary files |^GIT binary patch/m.test(text)) return { reason: '二进制文件' };
    return { text };
  }

  async prepareCommit(id) {
    return this.serialize(id, async () => {
      const repository = this.repository(id),
        initial = await this.getState(id);
      if (initial.operation)
        throw new WorkbenchError(
          `仓库正在进行 ${initial.operation}。第一阶段请在外部完成或中止后再提交。`,
          'OPERATION_IN_PROGRESS',
        );
      if (initial.locked)
        throw new WorkbenchError(
          'Git 索引被占用，请等待当前操作完成；工具不会删除锁文件。',
          'INDEX_LOCKED',
        );
      if (initial.files.some((file) => file.conflict))
        throw new WorkbenchError('存在尚未解决的冲突。', 'CONFLICTS');
      const signature = await this.signature(repository);
      const changed = await runGit(
        repository.root,
        ['diff', '--cached', '--quiet', '--exit-code'],
        { allowFailure: true },
      );
      if (changed.code === 0)
        throw new WorkbenchError('暂存区为空，请先选择本次提交内容。', 'EMPTY_INDEX');
      if (changed.code !== 1)
        throw new WorkbenchError(changed.stderr.trim() || '无法读取暂存区。', 'GIT_ERROR');
      const state = await this.getState(id);
      const token = crypto.randomUUID();
      const preview = {
        token,
        repositoryId: id,
        branch: state.detached ? `游离 HEAD · ${state.head?.slice(0, 8)}` : state.branch,
        detached: state.detached,
        head: signature.head,
        tree: signature.tree,
        ref: signature.ref,
        indexRevision: state.indexRevision,
        files: state.files.filter((file) => file.indexStatus !== '.'),
        createdAt: Date.now(),
      };
      this.previews.set(token, preview);
      if (this.previews.size > 100) this.previews.delete(this.previews.keys().next().value);
      return structuredClone(preview);
    });
  }

  async commit(id, token, message) {
    return this.serialize(id, async () => {
      const repository = this.repository(id);
      this.saveDraft(id, message);
      if (!message.trim()) throw new WorkbenchError('请填写提交说明。', 'EMPTY_MESSAGE');
      const preview = this.previews.get(token);
      if (!preview || preview.repositoryId !== id || Date.now() - preview.createdAt > 15 * 60_000)
        throw new WorkbenchError('提交预览已失效，请重新预览。', 'STALE_PREVIEW');
      const state = await this.getState(id);
      if (state.operation || state.files.some((file) => file.conflict))
        throw new WorkbenchError('仓库操作状态已变化，请刷新后处理。', 'STALE_PREVIEW');
      const signature = await this.signature(repository);
      if (
        signature.tree !== preview.tree ||
        signature.head !== preview.head ||
        signature.ref !== preview.ref
      )
        throw new WorkbenchError(
          '暂存内容或当前分支已变化。草稿已保留，请刷新提交预览。',
          'STALE_PREVIEW',
        );
      try {
        await runGit(repository.root, ['commit', '--file=-'], {
          input: message,
          timeout: 10 * 60_000,
        });
      } catch (error) {
        const currentHead = (
          await runGit(repository.root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
        ).stdout.trim();
        if (currentHead && currentHead !== preview.head)
          throw new WorkbenchError(
            `Git 返回错误，但 HEAD 已变为 ${currentHead}。请核对历史后再决定是否重试。`,
            'COMMIT_RESULT_UNCERTAIN',
            error.details || error.message,
          );
        throw error;
      }
      const actualHash = (await runGit(repository.root, ['rev-parse', 'HEAD'])).stdout.trim();
      const actualTree = (
        await runGit(repository.root, ['rev-parse', 'HEAD^{tree}'])
      ).stdout.trim();
      this.previews.delete(token);
      this.workspace.drafts[id] = '';
      this.persist();
      return {
        hash: actualHash,
        treeMatchesPreview: actualTree === preview.tree,
        warning:
          actualTree === preview.tree
            ? null
            : '实际提交内容与预览不同，可能由 Git 钩子或外部操作修改。请核对提交历史。',
      };
    });
  }

  async getHistory(id) {
    const repository = this.repository(id);
    const refs = (
      await runGit(repository.root, [
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ])
    ).stdout;
    const head = await runGit(repository.root, ['rev-parse', '--verify', 'HEAD'], {
      allowFailure: true,
    });
    if (!refs.trim() && head.code !== 0) return [];
    const raw = (
      await runGit(repository.root, [
        'log',
        '--topo-order',
        '--all',
        ...(head.code === 0 ? ['HEAD'] : []),
        '--max-count=150',
        '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00',
      ])
    ).stdout;
    return parseHistory(raw);
  }

  async getCommit(id, sha) {
    const repository = this.repository(id);
    if (typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha))
      throw new WorkbenchError('提交标识无效。', 'INVALID_COMMIT');
    const raw = (
      await runGit(repository.root, [
        'show',
        '--no-patch',
        '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00',
        sha,
      ])
    ).stdout;
    const commit = parseHistory(raw)[0];
    if (!commit) throw new WorkbenchError('无法读取所选提交。', 'INVALID_COMMIT');
    const nameArgs = commit.parents.length
      ? [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--name-status',
          '-z',
          '-M',
          commit.parents[0],
          sha,
        ]
      : ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', sha];
    const files = parseNameStatus((await runGit(repository.root, nameArgs)).stdout);
    const message = (
      await runGit(repository.root, ['show', '--no-patch', '--format=%B', sha])
    ).stdout.trimEnd();
    return { commit, files, message, firstParentView: commit.parents.length > 1 };
  }
}

module.exports = { GitService, WorkbenchError, runGit, parseStatus, parseHistory, parseNameStatus };
