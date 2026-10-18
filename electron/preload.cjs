const { contextBridge, ipcRenderer } = require('electron');

const methods = [
  'workspace',
  'pickRepository',
  'selectRepository',
  'removeRepository',
  'state',
  'diff',
  'stage',
  'unstage',
  'saveDraft',
  'prepareCommit',
  'commit',
  'history',
  'commitDetails',
  'modelSettings',
  'saveModelSettings',
  'testModelConnection',
  'reviewState',
  'saveReviewOptions',
  'prepareReview',
  'startReview',
  'cancelReview',
];
const api = { mode: 'desktop' };
for (const method of methods)
  api[method] = (...args) => ipcRenderer.invoke('codeguard:invoke', method, args);
api.onChanged = (callback) => {
  const listener = () => callback();
  ipcRenderer.on('codeguard:changed', listener);
  return () => ipcRenderer.removeListener('codeguard:changed', listener);
};
contextBridge.exposeInMainWorld('codeguard', api);
