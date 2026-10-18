import type {
  ApiMethod,
  Commit,
  CommitDetails,
  CommitPreview,
  CommitResult,
  DiffResult,
  DiffSelection,
  Envelope,
  Repository,
  RepositoryState,
  Workspace,
  ModelSettings,
  ReviewOptions,
  ReviewPreview,
  ReviewResult,
  ReviewState,
} from './types';

export class ApiError extends Error {
  code: string;
  details: string;
  constructor(message: string, code: string, details = '') {
    super(message);
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: ApiMethod, ...args: unknown[]): Promise<T> {
  let response: Envelope;
  if (window.codeguard) response = await window.codeguard[method](...args);
  else {
    const result = await fetch('/__codeguard/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CodeGuard-Preview': '1' },
      body: JSON.stringify({ method, args }),
    });
    if (!result.ok)
      throw new ApiError(
        '此页面需要从 CodeGuard 桌面程序或临时仓库预览启动。',
        'BRIDGE_UNAVAILABLE',
      );
    response = await result.json();
  }
  if (!response.ok)
    throw new ApiError(response.error.message, response.error.code, response.error.details);
  return response.value as T;
}

export const api = {
  modelSettings: () => request<ModelSettings>('modelSettings'),
  saveModelSettings: (settings: Partial<ModelSettings> & { apiKey?: string; clearKey?: boolean }) =>
    request<ModelSettings>('saveModelSettings', settings),
  testModelConnection: () =>
    request<{ message: string; totalTokens: number | null }>('testModelConnection'),
  reviewState: (id: string) => request<ReviewState>('reviewState', id),
  saveReviewOptions: (id: string, options: ReviewOptions) =>
    request<ReviewOptions>('saveReviewOptions', id, options),
  prepareReview: (id: string) => request<ReviewPreview>('prepareReview', id),
  startReview: (id: string, token: string) => request<ReviewResult>('startReview', id, token),
  cancelReview: (id: string) => request<void>('cancelReview', id),
  mode: window.codeguard ? 'desktop' : 'fixture',
  workspace: () => request<Workspace>('workspace'),
  pickRepository: () => request<Repository | null>('pickRepository'),
  selectRepository: (id: string) => request<Workspace>('selectRepository', id),
  removeRepository: (id: string) => request<Workspace>('removeRepository', id),
  state: (id: string) => request<RepositoryState>('state', id),
  diff: (id: string, selection: DiffSelection) => request<DiffResult>('diff', id, selection),
  stage: (id: string, file: string) => request<RepositoryState>('stage', id, file),
  unstage: (id: string, file: string) => request<RepositoryState>('unstage', id, file),
  saveDraft: (id: string, message: string) => request<void>('saveDraft', id, message),
  prepareCommit: (id: string) => request<CommitPreview>('prepareCommit', id),
  commit: (id: string, token: string, message: string) =>
    request<CommitResult>('commit', id, token, message),
  history: (id: string) => request<Commit[]>('history', id),
  commitDetails: (id: string, sha: string) => request<CommitDetails>('commitDetails', id, sha),
  onChanged: (callback: () => void) => {
    if (window.codeguard) return window.codeguard.onChanged(callback);
    window.addEventListener('focus', callback);
    return () => window.removeEventListener('focus', callback);
  },
};
