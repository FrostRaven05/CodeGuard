const { WorkbenchError } = require('./git-service.cjs');
const { GitOperations } = require('./git-operations.cjs');

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{20}$/.test(value))
    throw new WorkbenchError('仓库标识无效。', 'INVALID_REQUEST');
  return value;
}

function text(value, limit = 200_000) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0'))
    throw new WorkbenchError('请求内容无效。', 'INVALID_REQUEST');
  return value;
}

function createHandlers(service, chooseDirectory, reviews) {
  const operations = new GitOperations(service);
  return {
    remoteSettings: (id) => operations.remoteSettings(identifier(id)),
    changeRemote: (id, request) => operations.changeRemote(identifier(id), request),
    operationOptions: (id) => operations.options(identifier(id)),
    prepareOperation: (id, request) => operations.prepare(identifier(id), request),
    executeOperation: (id, token) => operations.execute(identifier(id), text(token, 80)),
    workspace: () => service.getWorkspace(),
    pickRepository: async () => {
      const directory = await chooseDirectory();
      return directory ? service.addRepository(directory) : null;
    },
    selectRepository: (id) => service.selectRepository(identifier(id)),
    removeRepository: (id) => {
      const key = identifier(id);
      reviews?.cancel(key);
      reviews?.commitMessages.cancel(key);
      return service.removeRepository(key);
    },
    state: (id) => service.getState(identifier(id)),
    diff: (id, selection) => {
      if (!selection || typeof selection !== 'object')
        throw new WorkbenchError('差异选择无效。', 'INVALID_REQUEST');
      return service.getDiff(identifier(id), {
        scope: text(selection.scope, 20),
        path: text(selection.path, 32_000),
        commit: selection.commit === undefined ? undefined : text(selection.commit, 64),
      });
    },
    stage: (id, file) => service.changeStaging(identifier(id), text(file, 32_000), 'stage'),
    stageAll: (id) => service.stageAll(identifier(id)),
    unstage: (id, file) => service.changeStaging(identifier(id), text(file, 32_000), 'unstage'),
    saveDraft: (id, message) => service.saveDraft(identifier(id), text(message)),
    prepareCommit: (id) => service.prepareCommit(identifier(id)),
    commit: (id, token, message) => service.commit(identifier(id), text(token, 80), text(message)),
    history: (id) => service.getHistory(identifier(id)),
    historyPage: (id, options) => service.getHistoryPage(identifier(id), options),
    commitDetails: (id, sha) => service.getCommit(identifier(id), text(sha, 64)),
    modelSettings: () => reviews.settings.getPublic(),
    saveModelSettings: (settings) => reviews.settings.save(settings),
    testModelConnection: () => reviews.testConnection(),
    reviewState: (id, scope) => reviews.state(identifier(id), scope),
    reviewProgress: (id, scope) => reviews.reviewProgress(identifier(id), scope),
    saveFindingDisposition: (id, request) => reviews.saveDisposition(identifier(id), request),
    reviewDiff: (id, request) => reviews.diff(identifier(id), request),
    saveReviewOptions: (id, options) => reviews.saveOptions(identifier(id), options),
    prepareReview: (id, scope) => reviews.prepare(identifier(id), scope),
    startReview: (id, token) => reviews.start(identifier(id), text(token, 80)),
    cancelReview: (id) => reviews.cancel(identifier(id)),
    prepareCommitMessage: (id) => reviews.commitMessages.prepare(identifier(id)),
    generateCommitMessage: (id, token) =>
      reviews.commitMessages.start(identifier(id), text(token, 80)),
    cancelCommitMessage: (id) => reviews.commitMessages.cancel(identifier(id)),
  };
}

async function invoke(handlers, method, args) {
  try {
    if (!Object.hasOwn(handlers, method) || !Array.isArray(args) || args.length > 3)
      throw new WorkbenchError('不支持的操作。', 'INVALID_REQUEST');
    return { ok: true, value: await handlers[method](...args) };
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error.message || '操作失败。',
        code: error.code || 'INTERNAL_ERROR',
        details: error.details || '',
      },
    };
  }
}

module.exports = { createHandlers, invoke };
