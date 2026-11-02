const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runGit, WorkbenchError, parseNameStatus } = require('./git-service.cjs');
const { excluded, sensitive } = require('./review-safety.cjs');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function readLocal(git, id, configuration) {
  const repository = git.repository(id);
  const state = await git.getState(id, { disableFilters: true });
  if (state.files.some((file) => file.conflict))
    throw new WorkbenchError('请先解决冲突，再理解全部本地改动。', 'CONFLICTS');
  if (state.files.length > 500)
    throw new WorkbenchError('本地改动超过 500 个文件，请缩小范围。', 'REVIEW_BUDGET');
  const ref =
    (
      await runGit(repository.root, ['symbolic-ref', '--quiet', 'HEAD'], { allowFailure: true })
    ).stdout.trim() || null;
  const entries = (await runGit(repository.root, ['ls-files', '--stage', '-z'])).stdout;
  const modes = new Map(
    entries
      .split('\0')
      .filter(Boolean)
      .map((row) => [row.slice(row.indexOf('\t') + 1), row.split(' ')[0]]),
  );
  const fileMode =
    (
      await runGit(repository.root, ['config', '--bool', 'core.filemode'], { allowFailure: true })
    ).stdout.trim() !== 'false';
  const paths = new Map();
  for (const file of state.files) {
    const reason = file.submodule
      ? '子模块不自动读取'
      : [file.path, file.previousPath]
            .filter(Boolean)
            .some((p) => excluded(p, configuration.excludePatterns))
        ? '排除规则或敏感路径'
        : null;
    for (const relative of [file.path, file.previousPath].filter(Boolean)) {
      const previous = paths.get(relative);
      paths.set(relative, {
        path: relative,
        reason: reason || previous?.reason,
        deleted:
          relative === file.previousPath ||
          file.worktreeStatus === 'D' ||
          (file.indexStatus === 'D' && file.worktreeStatus === '.'),
      });
    }
  }
  const files = [];
  for (const entry of [...paths.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const relative = entry.path;
    if (entry.reason) {
      files.push(entry);
      continue;
    }
    const absolute = git.absolutePath(repository, relative);
    try {
      // Check every ancestor, including junctions. No links or project filters are followed.
      let current = repository.root;
      for (const part of path.relative(repository.root, absolute).split(path.sep)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) {
          entry.reason = '符号链接或链接目录不自动读取';
          break;
        }
      }
      if (entry.reason) {
        files.push(entry);
        continue;
      }
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile()) entry.reason = '子模块或非普通文件';
      else if (stat.size > Math.min(configuration.maxContextChars, 100000))
        entry.reason = '文件超过上下文预算';
      if (entry.reason) {
        files.push(entry);
        continue;
      }
      const descriptor = fs.openSync(
        absolute,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
      let bytes;
      try {
        const opened = fs.fstatSync(descriptor);
        if (
          !opened.isFile() ||
          opened.size !== stat.size ||
          opened.ino !== stat.ino ||
          opened.dev !== stat.dev
        )
          throw new WorkbenchError('读取期间文件发生变化，请重新准备。', 'STALE_REVIEW');
        bytes = Buffer.alloc(opened.size + 1);
        const size = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
        if (size !== opened.size)
          throw new WorkbenchError('读取期间文件发生变化，请重新准备。', 'STALE_REVIEW');
        bytes = bytes.subarray(0, size);
        const after = fs.fstatSync(descriptor);
        if (opened.mtimeMs !== after.mtimeMs || opened.size !== after.size)
          throw new WorkbenchError('读取期间文件发生变化，请重新准备。', 'STALE_REVIEW');
        if (fs.realpathSync(absolute) !== absolute)
          throw new WorkbenchError('读取期间文件路径发生变化，请重新准备。', 'STALE_REVIEW');
      } finally {
        fs.closeSync(descriptor);
      }
      if (bytes.includes(0)) entry.reason = '二进制文件';
      else if (sensitive(bytes.toString('utf8'))) entry.reason = '检测到疑似密钥内容';
      if (!entry.reason) {
        entry.bytes = bytes;
        entry.digest = digest(bytes);
        entry.mode = fileMode
          ? stat.mode & 0o111
            ? '100755'
            : '100644'
          : modes.get(relative) === '100755'
            ? '100755'
            : '100644';
      }
      files.push(entry);
    } catch (error) {
      if (error instanceof WorkbenchError) throw error;
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        files.push({ path: relative, deleted: true });
      else files.push({ path: relative, reason: '无法安全读取本地文件' });
    }
  }
  const signature = {
    scope: 'local',
    head: state.head,
    ref,
    localRevision: digest(JSON.stringify(files.map(({ bytes, ...item }) => item))),
  };
  return { signature, files, state, repository };
}

async function localReviewSignature(git, id, configuration) {
  return (await readLocal(git, id, configuration)).signature;
}

async function captureLocalReview(git, id, configuration) {
  const { signature, files, state, repository } = await readLocal(git, id, configuration);
  if (!files.length) throw new WorkbenchError('没有本地改动可供理解。', 'EMPTY_LOCAL');
  const base =
    signature.head ||
    (
      await runGit(repository.root, ['hash-object', '-w', '-t', 'tree', '--stdin'], { input: '' })
    ).stdout.trim();
  const folder = fs.mkdtempSync(path.join(git.storageDirectory, 'local-snapshot-'));
  const indexFile = path.join(folder, 'index');
  const hooks = path.join(folder, 'hooks');
  fs.mkdirSync(hooks);
  const isolated = ['-c', 'core.splitIndex=false', '-c', `core.hooksPath=${hooks}`];
  try {
    await runGit(repository.root, [...isolated, 'read-tree', base], {
      indexFile,
    });
    const zero = '0'.repeat(base.length);
    const removals = [],
      additions = [];
    for (const file of files) {
      if (file.reason && !file.deleted) continue;
      removals.push(`0 ${zero}\t${file.path}\0`);
      if (!file.deleted) {
        const object = (
          await runGit(repository.root, ['hash-object', '--no-filters', '-w', '--stdin'], {
            input: file.bytes,
          })
        ).stdout.trim();
        additions.push(`${file.mode} ${object}\t${file.path}\0`);
      }
    }
    await runGit(repository.root, [...isolated, 'update-index', '-z', '--index-info'], {
      indexFile,
      input: removals.join('') + additions.join(''),
    });
    const tree = (
      await runGit(repository.root, [...isolated, 'write-tree'], { indexFile })
    ).stdout.trim();
    const changed = parseNameStatus(
      (
        await runGit(repository.root, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--find-renames',
          '--name-status',
          '-z',
          base,
          tree,
        ])
      ).stdout,
    );
    for (const file of files.filter((item) => item.reason))
      changed.push({ path: file.path, status: 'M', reason: file.reason });
    if (!changed.length)
      throw new WorkbenchError('当前工作区与 HEAD 相同，没有可理解的变化。', 'EMPTY_LOCAL');
    const after = await localReviewSignature(git, id, configuration);
    if (JSON.stringify(signature) !== JSON.stringify(after))
      throw new WorkbenchError('本地改动或分支已变化，请重新准备。', 'STALE_REVIEW');
    return {
      ...signature,
      base,
      tree,
      files: changed,
      repositoryId: id,
      indexRevision: state.indexRevision,
    };
  } finally {
    // The owned directory is created under application storage and is never a repository path.
    if (
      path.dirname(path.resolve(folder)) !== path.resolve(git.storageDirectory) ||
      !path.basename(folder).startsWith('local-snapshot-')
    )
      throw new WorkbenchError('临时快照路径无效。', 'INVALID_PATH');
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
module.exports = { captureLocalReview, localReviewSignature };
