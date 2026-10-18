const { WorkbenchError } = require('./git-service.cjs');

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
  return {
    workspace: () => service.getWorkspace(),
    pickRepository: async () => {
      const directory = await chooseDirectory();
      return directory ? service.addRepository(directory) : null;
    },
    selectRepository: (id) => service.selectRepository(identifier(id)),
    removeRepository: (id) => {
      const key = identifier(id);
      reviews?.cancel(key);
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
    unstage: (id, file) => service.changeStaging(identifier(id), text(file, 32_000), 'unstage'),
    saveDraft: (id, message) => service.saveDraft(identifier(id), text(message)),
    prepareCommit: (id) => service.prepareCommit(identifier(id)),
    commit: (id, token, message) => service.commit(identifier(id), text(token, 80), text(message)),
    history: (id) => service.getHistory(identifier(id)),
    commitDetails: (id, sha) => service.getCommit(identifier(id), text(sha, 64)),
    modelSettings: () => reviews.settings.getPublic(),
    saveModelSettings: (settings) => reviews.settings.save(settings),
    testModelConnection: () => reviews.testConnection(),
    reviewState: (id) => reviews.state(identifier(id)),
    saveReviewOptions: (id, options) => reviews.saveOptions(identifier(id), options),
    prepareReview: (id) => reviews.prepare(identifier(id)),
    startReview: (id, token) => reviews.start(identifier(id), text(token, 80)),
    cancelReview: (id) => reviews.cancel(identifier(id)),
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
