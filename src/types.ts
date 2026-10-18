export interface Repository {
  id: string;
  name: string;
  root: string;
  gitDir: string;
}
export interface Workspace {
  repositories: Repository[];
  activeRepositoryId: string | null;
  drafts: Record<string, string>;
  warning: string | null;
}
export interface ChangeFile {
  path: string;
  previousPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
  conflict: boolean;
  submodule: boolean;
}
export interface Branch {
  name: string;
  hash: string;
  current: boolean;
  remote: boolean;
}
export interface RepositoryState {
  repositoryId: string;
  branch: string;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  files: ChangeFile[];
  branches: Branch[];
  operation: string | null;
  locked: boolean;
  indexRevision: string;
  revision: string;
}
export interface DiffSelection {
  scope: 'index' | 'worktree' | 'commit';
  path: string;
  commit?: string;
}
export interface DiffResult {
  path: string;
  scope: string;
  text: string;
  truncated: boolean;
  binary: boolean;
  notice: string | null;
}
export interface Commit {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  subject: string;
}
export interface CommitFile {
  path: string;
  previousPath?: string;
  status: string;
}
export interface CommitDetails {
  commit: Commit;
  files: CommitFile[];
  message: string;
  firstParentView: boolean;
}
export interface CommitPreview {
  token: string;
  repositoryId: string;
  branch: string;
  detached: boolean;
  head: string | null;
  tree: string;
  ref: string | null;
  indexRevision: string;
  files: ChangeFile[];
  createdAt: number;
}
export interface CommitResult {
  hash: string;
  treeMatchesPreview: boolean;
  warning: string | null;
}
export type ApiMethod =
  | 'modelSettings'
  | 'saveModelSettings'
  | 'testModelConnection'
  | 'reviewState'
  | 'saveReviewOptions'
  | 'prepareReview'
  | 'startReview'
  | 'cancelReview'
  | 'workspace'
  | 'pickRepository'
  | 'selectRepository'
  | 'removeRepository'
  | 'state'
  | 'diff'
  | 'stage'
  | 'unstage'
  | 'saveDraft'
  | 'prepareCommit'
  | 'commit'
  | 'history'
  | 'commitDetails';
export interface ModelSettings {
  warning: string | null;
  baseUrl: string;
  model: string;
  maxContextChars: number;
  excludePatterns: string;
  revision: string;
  hasApiKey: boolean;
  keyStorage: 'system' | 'session';
}
export interface ReviewOptions {
  standards: string;
  requirements: string;
}
export interface ReviewPreview {
  token: string;
  repositoryId: string;
  tree: string;
  head: string | null;
  branch: string;
  model: string;
  baseUrl: string;
  included: { path: string; chars: number }[];
  skipped: { path: string; reason: string }[];
  chars: number;
  hasRequirements: boolean;
  hasStandards: boolean;
  createdAt: number;
}
export interface Finding {
  id: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  category: 'correctness' | 'standards' | 'requirements';
  title: string;
  path: string;
  side: 'new' | 'old';
  line: number;
  evidence: string;
  trigger: string;
  consequence: string;
  suggestion: string;
  evidenceStatus: string;
}
export interface ReviewResult {
  id: string;
  repositoryId: string;
  tree: string;
  head: string | null;
  indexRevision: string;
  model: string;
  createdAt: number;
  summary: string;
  findings: Finding[];
  unverifiedCount: number;
  included: string[];
  skipped: { path: string; reason: string }[];
  totalTokens: number | null;
  hasRequirements: boolean;
  hasStandards: boolean;
  stale: boolean;
}
export interface ReviewState {
  options: ReviewOptions;
  latest: ReviewResult | null;
  running: boolean;
  error: string | null;
}
export type Envelope =
  | { ok: true; value: unknown }
  | { ok: false; error: { message: string; code: string; details?: string } };
export type NativeBridge = Record<ApiMethod, (...args: unknown[]) => Promise<Envelope>> & {
  mode: 'desktop';
  onChanged: (callback: () => void) => () => void;
};
declare global {
  interface Window {
    codeguard?: NativeBridge;
  }
}
