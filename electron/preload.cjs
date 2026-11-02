const { contextBridge, ipcRenderer } = require('electron');

const methods = [
  'remoteSettings',
  'changeRemote',
  'operationOptions',
  'prepareOperation',
  'executeOperation',
  'workspace',
  'pickRepository',
  'selectRepository',
  'removeRepository',
  'state',
  'diff',
  'stage',
  'stageAll',
  'unstage',
  'saveDraft',
  'prepareCommit',
  'commit',
  'history',
  'historyPage',
  'saveFindingDisposition',
  'reviewDiff',
  'commitDetails',
  'modelSettings',
  'saveModelSettings',
  'testModelConnection',
  'reviewState',
  'reviewProgress',
  'saveReviewOptions',
  'prepareReview',
  'startReview',
  'cancelReview',
  'prepareCommitMessage',
  'generateCommitMessage',
  'cancelCommitMessage',
];
const api = { mode: 'desktop', customTitleBar: process.platform === 'win32' };
for (const method of methods)
  api[method] = (...args) => ipcRenderer.invoke('codeguard:invoke', method, args);
api.onChanged = (callback) => {
  const listener = () => callback();
  ipcRenderer.on('codeguard:changed', listener);
  return () => ipcRenderer.removeListener('codeguard:changed', listener);
};
api.onReviewProgress = (callback) => {
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on('codeguard:review-progress', listener);
  return () => ipcRenderer.removeListener('codeguard:review-progress', listener);
};
contextBridge.exposeInMainWorld('codeguard', api);
