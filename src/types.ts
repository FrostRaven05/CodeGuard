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
  upstreamRef?: string | null;
  ref: string;
  symbolic: boolean;
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
  scope: 'index' | 'worktree' | 'commit' | 'review';
  reviewId?: string;
  reviewScope?: ReviewScope;
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
export interface HistoryPage {
  commits: Commit[];
  hasMore: boolean;
  nextSkip: number;
}
export interface HistoryQuery {
  ref?: string;
  query?: string;
  skip?: number;
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
export interface CommitMessagePreview {
  token: string;
  repositoryId: string;
  tree: string;
  indexRevision: string;
  branch: string;
  model: string;
  baseUrl: string;
  included: { path: string; chars: number }[];
  skipped: { path: string; reason: string }[];
  chars: number;
  createdAt: number;
}
export interface GeneratedCommitMessage {
  message: string;
  repositoryId: string;
  tree: string;
  indexRevision: string;
  partial: boolean;
  totalTokens: number | null;
}
export type ApiMethod =
  | 'remoteSettings'
  | 'changeRemote'
  | 'operationOptions'
  | 'prepareOperation'
  | 'executeOperation'
  | 'prepareCommitMessage'
  | 'generateCommitMessage'
  | 'cancelCommitMessage'
  | 'modelSettings'
  | 'saveModelSettings'
  | 'testModelConnection'
  | 'reviewState'
  | 'reviewProgress'
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
  | 'stageAll'
  | 'unstage'
  | 'saveDraft'
  | 'prepareCommit'
  | 'commit'
  | 'historyPage'
  | 'reviewDiff'
  | 'saveFindingDisposition'
  | 'history'
  | 'commitDetails';
export type GitOperationKind =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'switch'
  | 'checkout'
  | 'createBranch'
  | 'merge'
  | 'continueMerge'
  | 'abortMerge';
export interface GitOperationRequest {
  localBranch?: string;
  kind: GitOperationKind;
  remote?: string;
  branch?: string;
  source?: string;
  pullToken?: string;
  setUpstream?: boolean;
  message?: string;
}
export interface GitOperationOptions {
  remotes: { name: string; fetchUrls: string[]; pushUrls: string[] }[];
  upstreamRemote: string;
  upstreamBranch: string;
  state: RepositoryState;
}
export interface RemoteSettings {
  revision: string;
  remotes: {
    name: string;
    fetchUrls: string[];
    pushUrls: string[];
    editable: boolean;
    removable: boolean;
    limitation: string | null;
    redacted: boolean;
    upstreamBranches: string[];
  }[];
}
export interface RemoteChange {
  kind: 'add' | 'edit' | 'remove';
  revision: string;
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}
export interface GitOperationPreview {
  localBranch?: string;
  token: string;
  repositoryId: string;
  kind: GitOperationKind;
  currentBranch: string;
  head: string;
  remote?: string;
  addresses?: string[];
  branch?: string;
  source?: string;
  sourceName?: string;
  target?: string;
  canExecute: boolean;
  warnings: string[];
  commits: Commit[];
  files: CommitFile[];
  localOnly: number;
  incoming: number;
  unrelated: boolean;
  message?: string;
}
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
export type ReviewScope = 'staged' | 'local';
export interface FindingDisposition {
  status: 'pending' | 'handled' | 'ignored';
  note: string;
  updatedAt?: number;
}
export interface DispositionRequest extends FindingDisposition {
  scope: ReviewScope;
  reviewId: string;
  findingId: string;
}
export interface ReviewOptions {
  standards: string;
  requirements: string;
}
export interface ReviewPreview {
  partialFiles?: { path: string; reason: string }[];
  scope: ReviewScope;
  token: string;
  repositoryId: string;
  tree: string;
  head: string | null;
  branch: string;
  model: string;
  baseUrl: string;
  included: { path: string; chars: number }[];
  skipped: { path: string; reason: string }[];
  contexts: ReviewContext[];
  contextSkipped: { path: string; reason: string }[];
  contextLimitation: string;
  chars: number;
  hasRequirements: boolean;
  hasStandards: boolean;
  createdAt: number;
}
export interface ReviewContext {
  path: string;
  side: 'old' | 'new';
  revision: string;
  startLine: number;
  endLine: number;
  kind: string;
  chars: number;
}
export interface Finding {
  key?: string;
  disposition?: FindingDisposition;
  recheckStatus?: 'not-found' | 'not-covered' | 'found-again';
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
  partialFiles?: { path: string; reason: string }[];
  investigation?: {
    items: {
      id: string;
      title: string;
      hypothesis: string;
      queries: string[];
      location: CodeLocation;
      verdict: 'supported' | 'refuted' | 'uncertain';
      conclusion: string;
      suggestion: string;
      evidence: CodeLocation[];
      matches: (CodeLocation & { startLine: number; text: string })[];
    }[];
    stats: {
      candidates: number;
      scanned: number;
      skipped: number;
      truncated: boolean;
      chars: number;
    };
    limitation: string;
  };
  scope?: ReviewScope;
  previousFindings?: Finding[];
  visuals?: ReviewVisuals;
  visualsRejected?: number;
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
  contexts?: ReviewContext[];
  contextSkipped?: { path: string; reason: string }[];
  contextLimitation?: string;
  durationMs?: number;
  hasRequirements: boolean;
  hasStandards: boolean;
  stale: boolean;
}
export interface CodeLocation {
  path: string;
  side: 'old' | 'new';
  line: number;
  evidence: string;
}
export interface ReviewFlow {
  title: string;
  nodes: {
    id: string;
    label: string;
    kind: 'start' | 'step' | 'decision' | 'end';
    location: CodeLocation | null;
  }[];
  edges: { from: string; to: string; label: string }[];
}
export interface ReviewVisuals {
  changes: { title: string; before: string; after: string; location: CodeLocation }[];
  flows: ReviewFlow[];
}
export interface ReviewState {
  preparation?: { label: string } | null;
  progress?: ReviewProgress | null;
  scope?: ReviewScope;
  options: ReviewOptions;
  latest: ReviewResult | null;
  running: boolean;
  runningScope?: ReviewScope | null;
  error: string | null;
}
export interface ReviewProgress {
  runId: string;
  repositoryId: string;
  scope: ReviewScope;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  model: string;
  fileCount: number;
  contextCount: number;
  receivedChars: number;
  summary: string;
  findings: Finding[];
  events: { phase: string; label: string; at: number }[];
}
export type Envelope =
  | { ok: true; value: unknown }
  | { ok: false; error: { message: string; code: string; details?: string } };
export type NativeBridge = Record<ApiMethod, (...args: unknown[]) => Promise<Envelope>> & {
  mode: 'desktop';
  customTitleBar: boolean;
  onChanged: (callback: () => void) => () => void;
  onReviewProgress: (callback: (progress: ReviewProgress) => void) => () => void;
};
declare global {
  interface Window {
    codeguard?: NativeBridge;
  }
}
