const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runGit, WorkbenchError, parseNameStatus, parseHistory } = require('./git-service.cjs');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const redact = (text) =>
  String(text)
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, '$1[凭据已隐藏]@')
    .replace(/([?&](?:token|key|password|secret|access_token)=)[^\s&#]+/gi, '$1[已隐藏]');
const kinds = ['fetch', 'pull', 'push', 'switch', 'merge', 'continueMerge', 'abortMerge'];

class GitOperations {
  constructor(service) {
    this.service = service;
    this.previews = new Map();
  }

  async git(root, args, options = {}) {
    try {
      return await runGit(root, args, options);
    } catch (error) {
      const details = redact(error.details || error.message).slice(0, 12000);
      if (
        /Authentication failed|could not read Username|Permission denied \(publickey\)|HTTP.*40[13]/i.test(
          details,
        )
      )
        throw new WorkbenchError(
          '远端认证失败，请检查系统 Git 的登录或 SSH 凭据。',
          'REMOTE_AUTH',
          details,
        );
      if (
        /non-fast-forward|\[rejected\].*(fetch first|stale info)|Updates were rejected/i.test(
          details,
        )
      )
        throw new WorkbenchError(
          '远端拒绝非快进推送。请先获取并比较远端改动。',
          'NON_FAST_FORWARD',
          details,
        );
      if (
        /Could not resolve|unable to access|Connection refused|Connection timed out|Could not read from remote/i.test(
          details,
        )
      )
        throw new WorkbenchError(
          '无法连接远端，请检查网络与仓库访问权限。',
          'REMOTE_NETWORK',
          details,
        );
      throw new WorkbenchError(redact(error.message), error.code, details);
    }
  }

  async options(id) {
    const root = this.service.repository(id).root;
    const state = await this.service.getState(id);
    const names = (await this.git(root, ['remote'])).stdout.trim().split('\n').filter(Boolean);
    const remotes = [];
    for (const name of names) {
      const fetchUrls = (await this.git(root, ['remote', 'get-url', '--all', name])).stdout
        .trim()
        .split('\n');
      const pushUrls = (await this.git(root, ['remote', 'get-url', '--push', '--all', name])).stdout
        .trim()
        .split('\n');
      remotes.push({ name, fetchUrls: fetchUrls.map(redact), pushUrls: pushUrls.map(redact) });
    }
    const config = async (key) =>
      (await this.git(root, ['config', '--get', key], { allowFailure: true })).stdout.trim();
    const upstreamRemote = state.detached ? '' : await config(`branch.${state.branch}.remote`);
    const upstreamBranch = state.detached
      ? ''
      : (await config(`branch.${state.branch}.merge`)).replace(/^refs\/heads\//, '');
    return { remotes, upstreamRemote, upstreamBranch, state };
  }

  async remoteSettings(id) {
    const root = this.service.repository(id).root;
    const read = async (local) => {
      const result = await this.git(
        root,
        [
          'config',
          ...(local ? ['--local', '--no-includes'] : []),
          '--null',
          '--get-regexp',
          '^(remote[.]|branch[.]|url[.])',
        ],
        { allowFailure: true },
      );
      if (![0, 1].includes(result.code))
        throw new WorkbenchError('无法读取远程仓库配置。', 'REMOTE_CONFIG_ERROR');
      return result.stdout;
    };
    const effective = await read(false),
      local = await read(true);
    const entries = (raw) =>
      raw
        .split('\0')
        .filter(Boolean)
        .map((row) => {
          const end = row.indexOf('\n');
          return [row.slice(0, end), row.slice(end + 1)];
        });
    const all = entries(effective),
      own = entries(local);
    const names = (await this.git(root, ['remote'])).stdout.trim().split('\n').filter(Boolean);
    const remotes = names.map((name) => {
      const prefix = `remote.${name}.`;
      const values = (key) => all.filter(([k]) => k === prefix + key).map(([, value]) => value);
      const fetchUrls = values('url'),
        pushUrls = values('pushurl');
      const owned =
        JSON.stringify(all.filter(([key]) => key.startsWith(prefix))) ===
        JSON.stringify(own.filter(([key]) => key.startsWith(prefix)));
      return {
        name,
        fetchUrls: fetchUrls.map(redact),
        pushUrls: pushUrls.map(redact),
        editable: owned && fetchUrls.length === 1 && pushUrls.length <= 1,
        removable: owned,
        limitation: !owned
          ? '来自全局或引入的配置，请在来源配置中调整。'
          : fetchUrls.length !== 1 || pushUrls.length > 1
            ? '此远端含多个地址或缺少获取地址，请通过系统 Git 编辑；现有地址保持原样。'
            : null,
        redacted: [...fetchUrls, ...pushUrls].some((value) => redact(value) !== value),
        upstreamBranches: all
          .filter(
            ([key, value]) =>
              key.startsWith('branch.') && key.endsWith('.remote') && value === name,
          )
          .map(([key]) => key.slice(7, -7)),
      };
    });
    return { revision: digest(JSON.stringify([effective, local])), remotes };
  }

  async changeRemote(id, request) {
    if (
      !request ||
      !['add', 'edit', 'remove'].includes(request.kind) ||
      typeof request.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(request.revision) ||
      typeof request.name !== 'string' ||
      !request.name ||
      request.name.length > 200 ||
      request.name.startsWith('-') ||
      /[\s\x00-\x1f\x7f]/.test(request.name)
    )
      throw new WorkbenchError('远程仓库名称或操作无效。', 'INVALID_REMOTE');
    const address = (value, optional = false) => {
      if (optional && value === '') return '';
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value !== value.trim() ||
        value.length > 4000 ||
        /^[\-]/.test(value) ||
        /[\x00-\x1f\x7f]/.test(value) ||
        /^[a-z][a-z\d+.-]*::/i.test(value)
      )
        throw new WorkbenchError(
          '请输入有效仓库地址，可使用 HTTPS、SSH 或本地路径。',
          'INVALID_REMOTE_URL',
        );
      if (
        /[a-z][a-z\d+.-]*:\/\/[^/\s]*:[^/@\s]+@/i.test(value) ||
        /https?:\/\/[^/\s@]+@|[?&](?:token|key|password|secret|access_token)=/i.test(value)
      )
        throw new WorkbenchError(
          '地址中请勿填写密码或令牌；认证沿用系统 Git 凭据或 SSH。',
          'INVALID_REMOTE_URL',
        );
      return value;
    };
    const fetchUrl = request.kind === 'remove' ? null : address(request.fetchUrl);
    const pushUrl = request.kind === 'remove' ? null : address(request.pushUrl, true);
    return this.service.serialize(id, async () => {
      const root = this.service.repository(id).root;
      if (
        (
          await this.git(
            root,
            ['check-ref-format', `refs/remotes/${request.name}/codeguard-check`],
            { allowFailure: true },
          )
        ).code
      )
        throw new WorkbenchError('远程仓库名称不符合 Git 规则。', 'INVALID_REMOTE');
      const current = await this.remoteSettings(id);
      if (current.revision !== request.revision)
        throw new WorkbenchError(
          '远端配置已被其他程序修改，请刷新列表后重新编辑。',
          'STALE_REMOTE_SETTINGS',
        );
      const target = current.remotes.find((item) => item.name === request.name);
      if (request.kind === 'add' && target)
        throw new WorkbenchError('此远程仓库名称已存在，请使用其他名称。', 'REMOTE_EXISTS');
      if (request.kind !== 'add' && !target)
        throw new WorkbenchError('此远程仓库已不存在，请刷新列表。', 'REMOTE_NOT_FOUND');
      if (
        (request.kind === 'edit' && !target.editable) ||
        (request.kind === 'remove' && !target.removable)
      )
        throw new WorkbenchError(target.limitation, 'REMOTE_READ_ONLY');
      let changed = false;
      try {
        if (request.kind === 'remove') {
          await this.git(root, ['remote', 'remove', request.name]);
        } else {
          if (request.kind === 'add') {
            await this.git(root, ['remote', 'add', '--', request.name, fetchUrl]);
            changed = true;
          } else if (fetchUrl !== target.fetchUrls[0]) {
            await this.git(root, [
              'config',
              '--local',
              '--replace-all',
              `remote.${request.name}.url`,
              fetchUrl,
            ]);
            changed = true;
          }
          if (pushUrl) {
            await this.git(root, [
              'config',
              '--local',
              '--replace-all',
              `remote.${request.name}.pushurl`,
              pushUrl,
            ]);
          } else if (target?.pushUrls.length) {
            await this.git(root, [
              'config',
              '--local',
              '--unset-all',
              `remote.${request.name}.pushurl`,
            ]);
          }
        }
        return await this.remoteSettings(id);
      } catch (error) {
        throw new WorkbenchError(
          changed
            ? '部分配置已写入，操作未完整完成。请刷新列表核对实际地址后重试。'
            : error.message,
          error.code || 'REMOTE_CONFIG_ERROR',
          error.details || '',
        );
      }
    });
  }

  async fingerprint(id) {
    const repository = this.service.repository(id);
    const state = await this.service.getState(id);
    const config = await this.git(
      repository.root,
      ['config', '--null', '--get-regexp', '^(remote\.|remotes\.|branch\.|url\.|push\.)'],
      { allowFailure: true },
    );
    const mergeMetadata = ['MERGE_HEAD', 'ORIG_HEAD', 'MERGE_AUTOSTASH', 'MERGE_MSG'].map(
      (name) => {
        try {
          return fs.readFileSync(path.join(repository.gitDir, name), 'utf8');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return '';
        }
      },
    );
    return {
      state,
      stamp: digest(
        JSON.stringify([
          state.worktreeRevision,
          state.operation,
          state.locked,
          config.stdout,
          mergeMetadata,
        ]),
      ),
    };
  }

  requireReady(state, kind) {
    if (state.locked)
      throw new WorkbenchError('Git 索引正在被占用，请稍后刷新；不会删除锁文件。', 'INDEX_LOCKED');
    if (['continueMerge', 'abortMerge'].includes(kind)) {
      if (state.operation !== 'merge')
        throw new WorkbenchError('当前没有可继续或中止的合并。', 'NO_MERGE');
      if (kind === 'continueMerge' && state.files.some((f) => f.conflict))
        throw new WorkbenchError('请先在外部解决冲突，并将解决后的文件暂存。', 'CONFLICTS');
      return;
    }
    if (state.operation || state.files.some((f) => f.conflict))
      throw new WorkbenchError('请先完成或中止当前仓库操作。', 'OPERATION_IN_PROGRESS');
    if (kind !== 'fetch' && (!state.head || (kind !== 'switch' && state.detached)))
      throw new WorkbenchError('请先切换到有提交的本地分支。', 'BRANCH_REQUIRED');
    if (['pull', 'merge'].includes(kind) && state.files.length)
      throw new WorkbenchError(
        '请先提交或自行保存本地改动，再拉取或合并。工具不会自动暂存改动。',
        'DIRTY_WORKTREE',
      );
  }

  async branchName(root, value) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 1000 ||
      value.startsWith('-') ||
      /[\r\n\0]/.test(value)
    )
      throw new WorkbenchError('请选择有效的目标分支。', 'INVALID_TARGET');
    const result = await this.git(root, ['check-ref-format', `refs/heads/${value}`], {
      allowFailure: true,
    });
    if (result.code) throw new WorkbenchError('目标分支名称无效。', 'INVALID_TARGET');
    return value;
  }

  async fetchBranch(root, remote, branch) {
    await this.git(
      root,
      [
        'fetch',
        '--no-tags',
        '--no-prune',
        '--no-recurse-submodules',
        '--',
        remote,
        `refs/heads/${branch}`,
      ],
      { timeout: 120000 },
    );
    return (await this.git(root, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).stdout.trim();
  }

  async remoteTip(root, remote, branch) {
    const raw = (
      await this.git(root, ['ls-remote', '--heads', '--', remote, `refs/heads/${branch}`], {
        timeout: 120000,
      })
    ).stdout.trim();
    if (!raw) return null;
    const [sha, ref] = raw.split(/\s+/);
    if (!/^[a-f0-9]{40,64}$/.test(sha) || ref !== `refs/heads/${branch}`)
      throw new WorkbenchError('远端分支响应无效。', 'INVALID_REMOTE');
    return sha;
  }

  async compare(root, from, to) {
    const counts = (
      await this.git(root, ['rev-list', '--left-right', '--count', `${from}...${to}`])
    ).stdout
      .trim()
      .split(/\s+/)
      .map(Number);
    const base = await this.git(root, ['merge-base', from, to], { allowFailure: true });
    const commits = parseHistory(
      (
        await this.git(root, [
          'log',
          '--max-count=100',
          '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00',
          `${from}..${to}`,
        ])
      ).stdout,
    );
    const files = parseNameStatus(
      (
        await this.git(root, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--name-status',
          '-z',
          from,
          to,
          '--',
        ])
      ).stdout,
    );
    return {
      localOnly: counts[0],
      incoming: counts[1],
      unrelated: !base.stdout.trim(),
      commits,
      files,
    };
  }

  async prepare(id, request) {
    return this.service.serialize(id, async () => {
      if (!request || !kinds.includes(request.kind))
        throw new WorkbenchError('操作类型无效。', 'INVALID_REQUEST');
      const { kind } = request;
      const root = this.service.repository(id).root;
      const before = await this.fingerprint(id);
      this.requireReady(before.state, kind);
      const options = await this.options(id);
      const preview = {
        token: crypto.randomUUID(),
        repositoryId: id,
        kind,
        currentBranch: before.state.branch,
        head: before.state.head,
        createdAt: Date.now(),
        warnings: [],
        canExecute: true,
        commits: [],
        files: [],
        localOnly: 0,
        incoming: 0,
        unrelated: false,
      };
      if (['fetch', 'pull', 'push'].includes(kind)) {
        const remote = options.remotes.find((item) => item.name === request.remote);
        if (!remote || remote.name.startsWith('-'))
          throw new WorkbenchError('请选择仓库中已配置的远端。', 'REMOTE_REQUIRED');
        preview.remote = remote.name;
        preview.addresses = kind === 'push' ? remote.pushUrls : remote.fetchUrls;
        if (kind === 'push' && remote.pushUrls.length !== 1)
          throw new WorkbenchError(
            '此远端配置了多个推送地址，请先在外部调整为单一地址。',
            'MULTIPLE_PUSH_URLS',
          );
        if (kind !== 'fetch') preview.branch = await this.branchName(root, request.branch);
        if (kind === 'pull')
          preview.target = await this.fetchBranch(root, remote.name, preview.branch);
        if (kind === 'push') {
          preview.setUpstream = request.setUpstream === true;
          preview.remoteHead = await this.remoteTip(root, remote.name, preview.branch);
          if (preview.remoteHead) {
            // Fetch comparison objects without changing the working tree.
            const fetched = await this.fetchBranch(root, remote.name, preview.branch);
            if (fetched !== preview.remoteHead)
              throw new WorkbenchError('远端已变化，请重新预览。', 'STALE_PREVIEW');
            const comparison = await this.compare(root, preview.remoteHead, before.state.head);
            Object.assign(preview, comparison);
            preview.canExecute = comparison.localOnly === 0 && !comparison.unrelated;
            if (!preview.canExecute)
              preview.warnings.push('远端含本地没有的提交，不能普通推送。请先拉取或显式合并。');
          } else {
            preview.commits = parseHistory(
              (
                await this.git(root, [
                  'log',
                  '--max-count=100',
                  '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00',
                  before.state.head,
                ])
              ).stdout,
            );
            preview.incoming = Number(
              (await this.git(root, ['rev-list', '--count', before.state.head])).stdout.trim(),
            );
            preview.files = (
              await this.git(root, ['ls-tree', '-r', '-z', '--name-only', before.state.head])
            ).stdout
              .split('\0')
              .filter(Boolean)
              .map((file) => ({ path: file, status: 'A' }));
            preview.warnings.push('将在远端创建这个分支。');
          }
        }
      }
      if (kind === 'switch' || (kind === 'merge' && !request.pullToken)) {
        const source = options.state.branches.find(
          (b) => b.ref === request.source && (kind !== 'switch' || !b.remote),
        );
        if (!source || source.current || source.symbolic)
          throw new WorkbenchError('请选择其他现有分支。', 'INVALID_TARGET');
        preview.source = source.ref;
        preview.sourceName = source.name;
        preview.target = source.hash;
      }
      if (kind === 'merge' && request.pullToken) {
        const pull = this.previews.get(request.pullToken);
        if (
          !pull ||
          pull.repositoryId !== id ||
          pull.kind !== 'pull' ||
          pull.stamp !== before.stamp ||
          Date.now() - pull.createdAt > 15 * 60000
        )
          throw new WorkbenchError('拉取预览已失效，请重新获取。', 'STALE_PREVIEW');
        preview.target = pull.target;
        preview.sourceName = `${pull.remote}/${pull.branch}`;
      }
      if (['pull', 'merge', 'switch'].includes(kind)) {
        Object.assign(preview, await this.compare(root, before.state.head, preview.target));
        if (kind === 'pull' && preview.localOnly && preview.incoming) {
          preview.canExecute = false;
          preview.warnings.push('本地与远端已经分叉。仅快进拉取不会执行，可单独预览显式合并。');
        }
        if (kind !== 'switch' && preview.unrelated) {
          preview.canExecute = false;
          preview.warnings.push('两个分支没有共同祖先，需在外部明确处理。');
        }
        if (kind === 'switch' && before.state.files.length)
          preview.warnings.push(
            '本地改动仅在 Git 确认可安全保留时随分支切换；不会强制覆盖或自动 stash。',
          );
        if (kind === 'merge' && preview.localOnly)
          preview.warnings.push(
            '当前分支有独有提交；来源分支的评审不能代表最终合并结果。合并可能产生冲突。',
          );
      }
      if (['continueMerge', 'abortMerge'].includes(kind)) {
        preview.files = before.state.files
          .filter((f) => kind === 'abortMerge' || (!f.untracked && f.indexStatus !== '.'))
          .map((f) => ({
            path: f.path,
            status: f.conflict ? 'U' : f.indexStatus,
          }));
        if (kind === 'continueMerge') {
          if (before.state.files.some((f) => !f.untracked && f.worktreeStatus !== '.'))
            throw new WorkbenchError(
              '解决后的改动尚未全部暂存，请核对后暂存再继续。',
              'UNSTAGED_MERGE',
            );
          preview.message =
            typeof request.message === 'string'
              ? request.message
              : fs.readFileSync(path.join(this.service.repository(id).gitDir, 'MERGE_MSG'), 'utf8');
          if (
            !preview.message.trim() ||
            preview.message.length > 200000 ||
            preview.message.includes('\0')
          )
            throw new WorkbenchError('请填写有效的合并提交说明。', 'INVALID_MESSAGE');
        } else
          preview.warnings.push(
            '中止合并将放弃当前冲突处理，尝试恢复到合并前。Git 无法恢复时会保留现场并报错。',
          );
      }
      const after = await this.fingerprint(id);
      if (after.stamp !== before.stamp)
        throw new WorkbenchError(
          '分支、配置或本地改动在准备期间发生变化，请重新预览。',
          'STALE_PREVIEW',
        );
      preview.stamp = after.stamp;
      this.previews.set(preview.token, preview);
      if (this.previews.size > 100) this.previews.delete(this.previews.keys().next().value);
      return structuredClone(preview);
    });
  }

  async execute(id, token) {
    return this.service.serialize(id, async () => {
      const preview = this.previews.get(token);
      if (!preview || preview.repositoryId !== id || Date.now() - preview.createdAt > 15 * 60000)
        throw new WorkbenchError('操作预览已失效，请重新预览。', 'STALE_PREVIEW');
      const root = this.service.repository(id).root;
      const current = await this.fingerprint(id);
      this.requireReady(current.state, preview.kind);
      if (current.stamp !== preview.stamp || !preview.canExecute)
        throw new WorkbenchError('操作对象已变化或不能执行，请重新预览。', 'STALE_PREVIEW');
      if (preview.source) {
        const sha = (
          await this.git(root, ['rev-parse', '--verify', `${preview.source}^{commit}`], {
            allowFailure: true,
          })
        ).stdout.trim();
        if (sha !== preview.target)
          throw new WorkbenchError('来源分支已变化，请重新预览。', 'STALE_PREVIEW');
      }
      this.previews.delete(token); // A request with uncertain outcome must not be blindly retried.
      const { kind } = preview;
      let warning = null;
      try {
        if (kind === 'fetch')
          await this.git(
            root,
            [
              '-c',
              'fetch.prune=false',
              '-c',
              'fetch.pruneTags=false',
              'fetch',
              '--no-prune',
              '--no-recurse-submodules',
              '--',
              preview.remote,
            ],
            { timeout: 120000 },
          );
        if (kind === 'push') {
          if ((await this.remoteTip(root, preview.remote, preview.branch)) !== preview.remoteHead)
            throw new WorkbenchError('远端分支已变化，请重新预览。', 'STALE_PREVIEW');
          if ((await this.fingerprint(id)).stamp !== preview.stamp)
            throw new WorkbenchError('分支、配置或本地改动已变化，请重新预览。', 'STALE_PREVIEW');
          // An object ID pins approved content even if a hook or another client moves the branch.
          await this.git(
            root,
            [
              '-c',
              `remote.${preview.remote}.mirror=false`,
              'push',
              '--porcelain',
              '--no-follow-tags',
              '--recurse-submodules=no',
              '--',
              preview.remote,
              `${preview.head}:refs/heads/${preview.branch}`,
            ],
            { timeout: 120000 },
          );
          if (preview.setUpstream) {
            try {
              await this.git(root, [
                'config',
                '--local',
                `branch.${preview.currentBranch}.remote`,
                preview.remote,
              ]);
              await this.git(root, [
                'config',
                '--local',
                `branch.${preview.currentBranch}.merge`,
                `refs/heads/${preview.branch}`,
              ]);
            } catch {
              warning = '推送已完成，但上游设置失败，请在外部检查分支配置。';
            }
          }
        }
        if (kind === 'switch')
          await this.git(root, [
            '-c',
            'submodule.recurse=false',
            'switch',
            '--no-guess',
            '--',
            preview.source.slice('refs/heads/'.length),
          ]);
        if (kind === 'pull' || kind === 'merge')
          await this.git(
            root,
            [
              '-c',
              `branch.${preview.currentBranch}.mergeOptions=`,
              '-c',
              'submodule.recurse=false',
              'merge',
              kind === 'pull' ? '--ff-only' : '--ff',
              '--no-autostash',
              '--no-edit',
              '--no-squash',
              '--commit',
              '--',
              preview.target,
            ],
            { timeout: 600000 },
          );
        if (kind === 'continueMerge')
          await this.git(root, ['commit', '--file=-'], { input: preview.message, timeout: 600000 });
        if (kind === 'abortMerge') await this.git(root, ['merge', '--abort']);
      } catch (error) {
        const state = await this.service.getState(id);
        if (state.operation === 'merge' || state.files.some((f) => f.conflict))
          throw new WorkbenchError(
            '合并尚未完成。请查看冲突文件，在外部解决并暂存后继续，或中止合并。',
            'MERGE_INCOMPLETE',
            redact(error.details || error.message),
          );
        throw error;
      }
      const state = await this.service.getState(id);
      if (
        kind === 'push' &&
        (state.head !== preview.head || state.branch !== preview.currentBranch)
      )
        warning = '已推送预览中的提交，但本地分支在执行期间发生变化，请核对实际状态。';
      if (kind === 'switch' && state.head !== preview.target)
        warning = 'Git 已切换分支，但目标版本在执行期间发生变化，请核对实际状态。';
      if (kind === 'merge' || kind === 'pull') {
        const included = await this.git(
          root,
          ['merge-base', '--is-ancestor', preview.target, 'HEAD'],
          { allowFailure: true },
        );
        if (included.code || state.operation)
          warning = 'Git 已返回成功，但来源版本未确认完整合入，请核对实际历史和操作状态。';
      }
      if (
        ['switch', 'pull', 'merge', 'continueMerge'].includes(kind) &&
        (state.detached ||
          state.branch !== (kind === 'switch' ? preview.source.slice(11) : preview.currentBranch))
      )
        warning = 'Git 已返回成功，但当前分支与预览不同，请核对实际状态。';
      return {
        state,
        warning,
        message: {
          fetch: '远端状态已获取，本地文件保持原样。',
          push: '推送完成。',
          pull: '拉取完成（仅快进）。',
          switch: '分支已切换。',
          merge: '合并完成。',
          continueMerge: '合并提交已完成。',
          abortMerge: '合并已中止。',
        }[kind],
      };
    });
  }
}

module.exports = { GitOperations };
