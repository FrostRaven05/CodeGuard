import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Settings2,
  Sparkles,
  FileCode2,
  FileDiff,
  Files,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Globe,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from './api';
import { DiffView } from './DiffView';
import { layoutGraph } from './graph';
import { ModelSettingsDialog } from './ModelSettingsDialog';
import { ReviewPanel } from './ReviewPanel';
import { ReviewWorkspace, type ReviewView } from './ReviewWorkspace';
import { RepositoryPicker } from './RepositoryPicker';
import { BranchMenu } from './BranchMenu';
import { GitOperationDialog, operationLabels } from './GitOperationDialog';
import { CommitMessageComposer } from './CommitMessageComposer';
import { RemoteSettingsDialog } from './RemoteSettingsDialog';
import type {
  Branch,
  ReviewScope,
  ChangeFile,
  Commit,
  CommitDetails,
  CommitPreview,
  DiffResult,
  DiffSelection,
  RepositoryState,
  Workspace,
  ReviewState,
  GitOperationRequest,
  CodeLocation,
} from './types';

type Notice = { kind: 'error' | 'success' | 'warning'; message: string; details?: string };
const shortPath = (value: string) => value.split('/').pop() || value;
const directoryOf = (value: string) =>
  value.includes('/') ? value.slice(0, value.lastIndexOf('/') + 1) : '';
const errorNotice = (error: unknown): Notice => ({
  kind: 'error',
  message: error instanceof Error ? error.message : '操作失败，请刷新后重试。',
  details: error instanceof ApiError && error.details !== error.message ? error.details : undefined,
});
const dateLabel = (date: string) =>
  new Date(date).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [state, setState] = useState<RepositoryState | null>(null);
  const [view, setView] = useState<'changes' | 'history' | 'review'>('changes');
  const [selection, setSelection] = useState<DiffSelection | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [history, setHistory] = useState<Commit[]>([]);
  const [historyRef, setHistoryRef] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [diffFilesOpen, setDiffFilesOpen] = useState(true);
  const [reviewScope, setReviewScope] = useState<ReviewScope>('local');
  const [commitReviewInfo, setCommitReviewInfo] = useState<ReviewState | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CommitPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [remoteReturn, setRemoteReturn] = useState<GitOperationRequest | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [reviewInfo, setReviewInfo] = useState<ReviewState | null>(null);
  const [reviewView, setReviewView] = useState<ReviewView>({ tab: 'changes', file: '' });
  const [findingFocus, setFindingFocus] = useState<CodeLocation | null>(null);
  const [gitOperation, setGitOperation] = useState<GitOperationRequest | null>(null);
  const activeId = workspace?.activeRepositoryId || null;
  const repository = workspace?.repositories.find((item) => item.id === activeId);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const refreshCounter = useRef(0);
  const historyKey = useRef('');
  const historyRequest = useRef(0);
  const overviewScroll = useRef<Record<string, number>>({ changes: 0, history: 0 });
  const draftQueue = useRef(new Map<string, Promise<unknown>>());
  const closePreviewButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let disposed = false;
    api
      .workspace()
      .then((saved) => {
        if (!disposed) {
          setWorkspace(saved);
          setDrafts(saved.drafts);
          if (saved.warning) setNotice({ kind: 'warning', message: saved.warning });
        }
      })
      .catch((error) => !disposed && setNotice(errorNotice(error)));
    return () => {
      disposed = true;
    };
  }, []);

  const refresh = useCallback(async (id: string, quiet = false) => {
    const request = ++refreshCounter.current;
    if (!quiet) setLoading(true);
    try {
      const next = await api.state(id);
      if (activeIdRef.current !== id || request !== refreshCounter.current) return;
      setState(next);
      setUpdatedAt(new Date());
      const key = `${id}:${next.head}:${next.branches.map((branch) => `${branch.name}:${branch.hash}`).join('|')}`;
      if (historyKey.current !== key) {
        historyKey.current = key;
        setHistoryVersion((value) => value + 1);
      }
    } catch (error) {
      if (activeIdRef.current === id && request === refreshCounter.current)
        setNotice(errorNotice(error));
    } finally {
      if (request === refreshCounter.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCounter.current++;
    historyKey.current = '';
    setState(null);
    setHistory([]);
    setHistoryRef('');
    setHistorySearch('');
    setHistoryQuery('');
    setReviewScope('local');
    setCommitReviewInfo(null);
    overviewScroll.current = { changes: 0, history: 0 };
    historyRequest.current++;
    setSelectedCommit(null);
    setCommitDetails(null);
    setSelection(null);
    setDiff(null);
    setPreview(null);
    setPreviewOpen(false);
    setReviewInfo(null);
    setReviewView({ tab: 'changes', file: '' });
    setRemotesOpen(false);
    setRemoteReturn(null);
    setFindingFocus(null);
    setGitOperation(null);
    setView('changes');
    if (!activeId) return;
    void refresh(activeId);
    const update = () => {
      if (!busyRef.current && document.visibilityState === 'visible') void refresh(activeId, true);
    };
    const unsubscribe = api.onChanged(update);
    const interval = window.setInterval(update, 4000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [activeId, refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHistoryQuery(historySearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [historySearch]);

  useEffect(() => {
    if (!activeId || state?.repositoryId !== activeId) return;
    let disposed = false;
    const generation = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError('');
    setHistory([]);
    setHistoryHasMore(false);
    void api
      .historyPage(activeId, { ref: historyRef, query: historyQuery })
      .then((page) => {
        if (disposed || generation !== historyRequest.current) return;
        setHistory(page.commits);
        setHistoryHasMore(page.hasMore);
        setHistoryCursor(page.nextSkip);
        setSelectedCommit((selected) =>
          page.commits.some((item) => item.hash === selected)
            ? selected
            : page.commits[0]?.hash || null,
        );
      })
      .catch((error) => {
        if (!disposed && generation === historyRequest.current) setHistoryError(error.message);
      })
      .finally(() => {
        if (!disposed && generation === historyRequest.current) setHistoryLoading(false);
      });
    return () => {
      disposed = true;
      historyRequest.current++;
    };
  }, [activeId, state?.repositoryId, historyRef, historyQuery, historyVersion]);

  async function loadMoreHistory() {
    if (!activeId || historyLoading || !historyHasMore) return;
    const generation = historyRequest.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const page = await api.historyPage(activeId, {
        ref: historyRef,
        query: historyQuery,
        skip: historyCursor,
      });
      if (generation !== historyRequest.current) return;
      setHistory((previous) => [
        ...new Map([...previous, ...page.commits].map((item) => [item.hash, item])).values(),
      ]);
      setHistoryHasMore(page.hasMore);
      setHistoryCursor(page.nextSkip);
    } catch (error) {
      if (generation === historyRequest.current)
        setHistoryError(error instanceof Error ? error.message : '无法加载历史');
    } finally {
      if (generation === historyRequest.current) setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!previewOpen || !activeId) return;
    let disposed = false;
    void api
      .reviewState(activeId, 'staged')
      .then((value) => {
        if (!disposed) setCommitReviewInfo(value);
      })
      .catch(() => {
        if (!disposed) setCommitReviewInfo(null);
      });
    return () => {
      disposed = true;
    };
  }, [previewOpen, activeId, state?.indexRevision, settingsVersion]);

  useEffect(() => {
    if (!activeId || !selection) {
      setDiff(null);
      return;
    }
    let disposed = false;
    setDiffLoading(true);
    (selection.scope === 'review'
      ? api.reviewDiff(activeId, {
          scope: selection.reviewScope || 'staged',
          reviewId: selection.reviewId || '',
          path: selection.path,
        })
      : api.diff(activeId, selection)
    )
      .then((result) => {
        if (!disposed) setDiff(result);
      })
      .catch((error) => {
        if (!disposed) {
          setDiff(null);
          setNotice(errorNotice(error));
        }
      })
      .finally(() => {
        if (!disposed) setDiffLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeId, selection, state?.revision]);

  useEffect(() => {
    if (!activeId || !selectedCommit) {
      setCommitDetails(null);
      return;
    }
    let disposed = false;
    setDetailLoading(true);
    setCommitDetails(null);
    api
      .commitDetails(activeId, selectedCommit)
      .then((result) => {
        if (!disposed) setCommitDetails(result);
      })
      .catch((error) => !disposed && setNotice(errorNotice(error)))
      .finally(() => !disposed && setDetailLoading(false));
    return () => {
      disposed = true;
    };
  }, [activeId, selectedCommit]);

  useEffect(() => {
    if (!previewOpen) return;
    closePreviewButton.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        setPreviewOpen(false);
        previewButton.current?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [previewOpen]);

  const staged = state?.files.filter((file) => file.indexStatus !== '.' && !file.conflict) || [];
  const unstaged =
    state?.files.filter(
      (file) => !file.untracked && (file.worktreeStatus !== '.' || file.conflict),
    ) || [];
  const untracked = state?.files.filter((file) => file.untracked) || [];
  const conflicts = state?.files.filter((file) => file.conflict).length || 0;
  const canStageAll =
    !!state && !busy && !conflicts && !state.locked && !!(unstaged.length || untracked.length);
  const selectedFile = state?.files.find((file) => file.path === selection?.path);
  const draft = activeId ? drafts[activeId] || '' : '';
  const graph = useMemo(() => layoutGraph(history), [history]);
  const previewStale =
    !!preview &&
    !!state &&
    (state.repositoryId !== preview.repositoryId || state.indexRevision !== preview.indexRevision);

  function saveDraft(message: string) {
    if (!activeId) return;
    const id = activeId;
    setDrafts((previous) => ({ ...previous, [id]: message }));
    const next = (draftQueue.current.get(id) || Promise.resolve())
      .catch(() => {})
      .then(() => api.saveDraft(id, message));
    draftQueue.current.set(id, next);
    void next.catch((error) => setNotice(errorNotice(error)));
  }

  async function pickRepository() {
    setBusy('打开仓库');
    setNotice(null);
    try {
      const picked = await api.pickRepository();
      if (picked) setWorkspace(await api.workspace());
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(null);
    }
  }

  async function switchRepository(id: string) {
    if (id === activeId) return;
    setBusy('切换仓库');
    setNotice(null);
    try {
      if (activeId) await draftQueue.current.get(activeId);
      const next = await api.selectRepository(id);
      setWorkspace(next);
      setDrafts(next.drafts);
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeRepository() {
    if (!activeId) return;
    setBusy('移除列表项');
    try {
      await draftQueue.current.get(activeId);
      const next = await api.removeRepository(activeId);
      setWorkspace(next);
      setDrafts(next.drafts);
      setNotice({ kind: 'success', message: '已从列表移除，本地仓库和文件保持原样。' });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(null);
    }
  }

  async function changeStaging(file: ChangeFile, action: 'stage' | 'unstage') {
    if (!activeId) return;
    const id = activeId;
    setBusy(action === 'stage' ? '暂存文件' : '取消暂存');
    setNotice(null);
    try {
      const next = await api[action](id, file.path);
      if (activeIdRef.current !== id) return;
      setState(next);
      setUpdatedAt(new Date());
      const updated = next.files.find((item) => item.path === file.path);
      if (updated)
        setSelection({
          path: updated.path,
          scope: action === 'stage' && updated.indexStatus !== '.' ? 'index' : 'worktree',
        });
      else setSelection(null);
      await refresh(id, true);
    } catch (error) {
      setNotice(errorNotice(error));
      await refresh(id, true);
    } finally {
      setBusy(null);
    }
  }

  async function prepareCommit() {
    if (!activeId) return;
    setBusy('准备提交');
    setNotice(null);
    try {
      await draftQueue.current.get(activeId);
      const next = await api.prepareCommit(activeId);
      await refresh(activeId, true);
      setPreview(next);
      setPreviewOpen(true);
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(null);
    }
  }

  async function stageAll() {
    if (!activeId || busyRef.current) return;
    const id = activeId;
    setBusy('暂存全部');
    setNotice(null);
    try {
      const next = await api.stageAll(id);
      if (activeIdRef.current !== id) return;
      setState(next);
      setUpdatedAt(new Date());
      setNotice({ kind: 'success', message: '已暂存全部改动。' });
      setSelection((current) => {
        if (!current || current.scope === 'commit' || current.scope === 'review') return current;
        const file = next.files.find((item) => item.path === current.path);
        return file ? { path: file.path, scope: 'index' } : null;
      });
      await refresh(id, true);
    } catch (error) {
      if (activeIdRef.current === id) setNotice(errorNotice(error));
      await refresh(id, true);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!activeId || !preview) return;
    const id = activeId;
    setBusy('正在提交');
    setNotice(null);
    try {
      await draftQueue.current.get(id);
      const result = await api.commit(id, preview.token, drafts[id] || '');
      setDrafts((previous) => ({ ...previous, [id]: '' }));
      setPreview(null);
      setPreviewOpen(false);
      setSelection(null);
      setNotice({
        kind: result.warning ? 'warning' : 'success',
        message: result.warning || `提交成功 · ${result.hash.slice(0, 12)}`,
        details: result.warning ? `实际提交：${result.hash}` : result.hash,
      });
      await refresh(id, true);
    } catch (error) {
      setNotice(errorNotice(error));
      if (error instanceof ApiError && error.code === 'STALE_PREVIEW') setPreview(null);
      await refresh(id, true);
    } finally {
      setBusy(null);
    }
  }

  function selectView(next: 'changes' | 'history' | 'review') {
    setView(next);
    setSelection(null);
    setDiff(null);
    setFindingFocus(null);
  }
  function locateCode(location: CodeLocation) {
    setFindingFocus(location);
    if (reviewInfo?.latest)
      setSelection({
        scope: 'review',
        path: location.path,
        reviewId: reviewInfo.latest.id,
        reviewScope,
      });
  }
  function selectHistory(branch: Branch) {
    selectView('history');
    setHistoryRef(branch.ref);
    setHistorySearch('');
    setHistoryQuery('');
    setSelectedCommit(branch.hash);
  }
  function changeReviewScope(scope: ReviewScope) {
    if (scope === reviewScope) return;
    setReviewScope(scope);
    setReviewInfo(null);
    setSelection(null);
    setReviewView({ tab: 'changes', file: '' });
  }

  const diffFiles: { label: string; selection: DiffSelection }[] =
    view === 'history' && commitDetails
      ? commitDetails.files.map((file) => ({
          label: '历史提交',
          selection: { scope: 'commit', commit: commitDetails.commit.hash, path: file.path },
        }))
      : view === 'review' && reviewInfo?.latest
        ? reviewInfo.latest.included.map((path) => ({
            label: reviewScope === 'local' ? '本地快照' : '暂存快照',
            selection: { scope: 'review', path, reviewId: reviewInfo.latest!.id, reviewScope },
          }))
        : [
            ...unstaged.map((file) => ({
              label: '未暂存',
              selection: { scope: 'worktree' as const, path: file.path },
            })),
            ...staged.map((file) => ({
              label: '已暂存',
              selection: { scope: 'index' as const, path: file.path },
            })),
            ...untracked.map((file) => ({
              label: '未跟踪',
              selection: { scope: 'worktree' as const, path: file.path },
            })),
          ];
  const diffFileIndex = diffFiles.findIndex(
    (item) => item.selection.path === selection?.path && item.selection.scope === selection.scope,
  );
  function navigateDiff(next: DiffSelection) {
    setFindingFocus(null);
    setSelection(next);
  }
  function moveDiff(offset: number) {
    const file = diffFiles[diffFileIndex + offset];
    if (file) navigateDiff(file.selection);
  }

  function fileGroup(
    title: string,
    files: ChangeFile[],
    scope: 'index' | 'worktree',
    kind: string,
  ) {
    const isCollapsed = collapsed[kind];
    return (
      <section className="change-group" key={kind}>
        <button
          className="group-heading"
          onClick={() => setCollapsed((previous) => ({ ...previous, [kind]: !previous[kind] }))}
          aria-expanded={!isCollapsed}
        >
          <ChevronRight size={13} className={isCollapsed ? '' : 'rotate'} />
          <span>{title}</span>
          <span className="count">{files.length}</span>
        </button>
        {!isCollapsed &&
          (files.length ? (
            files.map((file) => {
              const code = file.conflict
                ? 'U'
                : file.untracked
                  ? '?'
                  : scope === 'index'
                    ? file.indexStatus
                    : file.worktreeStatus;
              const selected = selection?.scope === scope && selection.path === file.path;
              return (
                <div
                  className={`file-row ${selected ? 'selected' : ''}`}
                  key={`${scope}:${file.path}`}
                >
                  <button
                    className="file-select"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => {
                      selectView('changes');
                      setSelection({ scope, path: file.path });
                    }}
                    title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                  >
                    <span className={`file-status status-${code}`}>{code}</span>
                    <span className="file-path">
                      <strong>{shortPath(file.path)}</strong>
                      <small>
                        {directoryOf(file.path) || '仓库根目录'}
                        {file.previousPath ? ` ← ${file.previousPath}` : ''}
                      </small>
                    </span>
                    {file.submodule ? (
                      <span className="small-tag">子模块</span>
                    ) : (
                      <FileCode2 size={14} className="file-icon" />
                    )}
                  </button>
                  <button
                    className="icon-button file-action"
                    disabled={!!busy}
                    onClick={() =>
                      void changeStaging(file, scope === 'index' ? 'unstage' : 'stage')
                    }
                    title={scope === 'index' ? '取消暂存整文件' : '暂存整文件'}
                    aria-label={`${scope === 'index' ? '取消暂存' : '暂存'} ${file.path}`}
                  >
                    {scope === 'index' ? <Minus size={15} /> : <Plus size={15} />}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="group-empty">
              {scope === 'index' ? '选中的提交内容会出现在这里' : '没有文件'}
            </div>
          ))}
      </section>
    );
  }

  return (
    <div className={`app-shell${api.customTitleBar ? ' desktop-shell' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <GitBranch size={23} strokeWidth={2.2} />
          <span>CodeGuard</span>
        </div>
        <RepositoryPicker
          repositories={workspace?.repositories || []}
          activeId={activeId}
          disabled={!!busy}
          onSelect={(id) => void switchRepository(id)}
          onManageRemotes={() => setRemotesOpen(true)}
        />
        {state && (
          <BranchMenu
            state={state}
            disabled={!!busy}
            onOperation={setGitOperation}
            onHistory={selectHistory}
          />
        )}
        <div className="titlebar-drag-region" aria-hidden="true" />
        <div className="toolbar">
          {api.mode === 'fixture' && <span className="local-label fixture-label">临时仓库</span>}
          <button
            className="toolbar-button"
            disabled={!!busy || !activeId || loading}
            onClick={() => activeId && void refresh(activeId)}
            title="刷新本地状态"
            aria-label="刷新"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span className="toolbar-extra-label">刷新</span>
          </button>
          <div className="sync-toolbar" aria-label="远端同步">
            <button
              className="toolbar-button"
              disabled={!!busy || !state}
              onClick={() => setGitOperation({ kind: 'fetch' })}
              title="获取远端状态"
            >
              <RefreshCw size={14} />
              获取
            </button>
            <button
              className="toolbar-button"
              disabled={!!busy || !state}
              onClick={() => setGitOperation({ kind: 'pull' })}
              title="拉取（仅快进）"
            >
              <ArrowDown size={14} />
              拉取{!!state?.behind && <small>{state.behind}</small>}
            </button>
            <button
              className="toolbar-button"
              disabled={!!busy || !state}
              onClick={() => setGitOperation({ kind: 'push' })}
              title="预览并推送"
            >
              <ArrowUp size={14} />
              推送{!!state?.ahead && <small>{state.ahead}</small>}
            </button>
          </div>
          <button
            className="toolbar-button"
            disabled={!!busy}
            onClick={() => void pickRepository()}
            title="打开仓库"
            aria-label="打开仓库"
          >
            <FolderOpen size={15} />
            <span className="toolbar-extra-label">打开仓库</span>
          </button>
          <button
            className="toolbar-button"
            aria-label="模型设置"
            title="模型设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={15} />
            <span className="toolbar-extra-label">模型设置</span>
          </button>
        </div>
      </header>

      <div className="body-layout">
        <aside className="sidebar" aria-label="当前改动文件">
          <div className="sidebar-changes-heading">
            <h2>当前改动{state && <span className="count">{state.files.length}</span>}</h2>
            {state && (
              <button
                className="secondary stage-all-button"
                aria-label="暂存全部"
                title={
                  conflicts
                    ? '请先处理冲突文件'
                    : state.locked
                      ? 'Git 索引正在被占用'
                      : '暂存全部修改、新增和删除，遵循 Git 忽略规则'
                }
                disabled={!canStageAll}
                onClick={() => void stageAll()}
              >
                {busy === '暂存全部' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Plus size={14} />
                )}
                {busy === '暂存全部' ? '暂存中…' : '暂存全部'}
              </button>
            )}
          </div>
          <div
            className="sidebar-changes"
            ref={(element) => {
              if (element) element.scrollTop = overviewScroll.current.changes || 0;
            }}
            onScroll={(event) => {
              overviewScroll.current.changes = event.currentTarget.scrollTop;
            }}
          >
            {unstaged.length > 0 && fileGroup('未暂存', unstaged, 'worktree', 'unstaged')}
            {staged.length > 0 && fileGroup('已暂存', staged, 'index', 'staged')}
            {untracked.length > 0 && fileGroup('未跟踪', untracked, 'worktree', 'untracked')}
            {!state && (
              <p className="sidebar-empty">
                {repository
                  ? loading
                    ? '正在读取改动…'
                    : '无法读取改动，请刷新'
                  : '打开仓库后查看改动'}
              </p>
            )}
            {state && !state.files.length && (
              <p className="sidebar-empty" role="status">
                <Check size={15} />
                {state.head ? '没有本地改动' : '暂无文件，添加文件后刷新'}
              </p>
            )}
          </div>
          <div className="sidebar-bottom">
            {repository && (
              <>
                <button
                  className="nav-item manage-remotes-button"
                  disabled={!!busy}
                  onClick={() => setRemotesOpen(true)}
                >
                  <Globe size={15} />
                  管理远程仓库
                </button>
                <button
                  className="remove-repo"
                  disabled={!!busy}
                  onClick={() => void removeRepository()}
                  title="仅从 CodeGuard 列表移除，不删除本地目录"
                >
                  <Trash2 size={12} />
                  从列表移除
                </button>
              </>
            )}
          </div>
        </aside>

        <main className="main-panel">
          <nav className="view-tabs" aria-label="主视图">
            <button
              className={view === 'changes' ? 'active' : ''}
              onClick={() => selectView('changes')}
            >
              <Files size={14} />
              当前改动{state && <span className="count">{state.files.length}</span>}
            </button>
            <button
              className={view === 'history' ? 'active' : ''}
              onClick={() => selectView('history')}
            >
              <GitCommitHorizontal size={15} />
              提交历史
            </button>
            <button
              className={view === 'review' ? 'active' : ''}
              onClick={() => selectView('review')}
            >
              <Sparkles size={14} />
              可视化审查
            </button>
          </nav>
          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              {notice.kind === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              <div>
                <strong>{notice.message}</strong>
                {notice.details && (
                  <details>
                    <summary>查看详情</summary>
                    <pre>{notice.details}</pre>
                  </details>
                )}
              </div>
              <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X size={14} />
              </button>
            </div>
          )}
          {!repository ? (
            <div className="welcome">
              <div className="welcome-icon">
                <FolderGit2 size={38} />
              </div>
              <h1>从一个本地仓库开始</h1>
              <p>看清改动，选择提交内容，沿着分支查看历史。</p>
              <button className="primary" disabled={!!busy} onClick={() => void pickRepository()}>
                <FolderOpen size={16} />
                打开 Git 仓库
              </button>
              <small>添加已有目录；不会克隆、修改源码或自动暂存。</small>
            </div>
          ) : !state ? (
            <div className="center-message">
              {loading ? <LoaderCircle size={24} className="spin" /> : <AlertTriangle size={24} />}
              <h3>{loading ? '读取仓库…' : '暂时无法读取仓库'}</h3>
              <p>{loading ? repository.root : '确认目录仍可访问，然后点击刷新。'}</p>
            </div>
          ) : selection ? (
            <section className="diff-panel">
              <div className="diff-toolbar">
                <button className="back-button" onClick={() => setSelection(null)}>
                  <ArrowLeft size={14} />
                  {view === 'history' ? '返回历史' : view === 'review' ? '返回审查' : '关闭差异'}
                </button>
                <span className={`scope-chip ${selection.scope === 'index' ? 'mint' : ''}`}>
                  {selection.scope === 'index'
                    ? '已暂存 · 本次提交'
                    : selection.scope === 'review'
                      ? `${selection.reviewScope === 'local' ? '全部本地改动' : '本次提交'} · 固定快照`
                      : selection.scope === 'commit'
                        ? `提交 ${selection.commit?.slice(0, 8)}`
                        : '未暂存 · 工作区'}
                </span>
                {(selection.scope === 'index' || selection.scope === 'worktree') &&
                  selectedFile && (
                    <div className="diff-staging-actions">
                      <button
                        className="secondary"
                        disabled={!!busy || state.locked}
                        onClick={() =>
                          void changeStaging(
                            selectedFile,
                            selection.scope === 'index' ? 'unstage' : 'stage',
                          )
                        }
                      >
                        {selection.scope === 'index' ? <Minus size={14} /> : <Plus size={14} />}
                        {selection.scope === 'index' ? '取消暂存' : '暂存此文件'}
                      </button>
                      <button
                        className="secondary"
                        disabled={!canStageAll}
                        aria-label="暂存全部"
                        onClick={() => void stageAll()}
                      >
                        <Plus size={14} />
                        {busy === '暂存全部' ? '正在暂存…' : '暂存全部'}
                      </button>
                    </div>
                  )}
              </div>
              <div className="diff-navigation-toolbar">
                {(selection.scope === 'commit' || selection.scope === 'review') && (
                  <button
                    className="secondary"
                    aria-label="切换差异文件列表"
                    aria-pressed={diffFilesOpen}
                    onClick={() => setDiffFilesOpen(!diffFilesOpen)}
                  >
                    {diffFilesOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                    文件列表
                  </button>
                )}
                <span>
                  {diffFileIndex >= 0 ? `${diffFileIndex + 1} / ${diffFiles.length}` : '固定版本'}
                </span>
                <button
                  className="secondary"
                  aria-label="上一文件"
                  disabled={diffFileIndex <= 0}
                  onClick={() => moveDiff(-1)}
                >
                  <ArrowLeft size={14} />
                  上一文件
                </button>
                <button
                  className="secondary"
                  aria-label="下一文件"
                  disabled={diffFileIndex < 0 || diffFileIndex >= diffFiles.length - 1}
                  onClick={() => moveDiff(1)}
                >
                  下一文件
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="diff-browser">
                {diffFilesOpen &&
                  (selection.scope === 'commit' || selection.scope === 'review') && (
                    <nav className="diff-file-nav" aria-label="差异文件">
                      {diffFiles.map((item, index) => (
                        <button
                          key={`${item.selection.scope}:${item.selection.path}`}
                          className={index === diffFileIndex ? 'selected' : ''}
                          aria-current={index === diffFileIndex ? 'true' : undefined}
                          title={`${item.label} · ${item.selection.path}`}
                          onClick={() => navigateDiff(item.selection)}
                        >
                          <span>{item.selection.path}</span>
                          <small>{item.label}</small>
                        </button>
                      ))}
                    </nav>
                  )}
                <div className="diff-document">
                  <div className="diff-title">
                    <FileDiff size={17} />
                    <h2 title={selection.path}>{selection.path}</h2>
                  </div>
                  <DiffView
                    diff={diff}
                    loading={diffLoading}
                    focus={
                      (selection?.scope === 'index' || selection?.scope === 'review') &&
                      findingFocus &&
                      (selection.path === findingFocus.path ||
                        state?.files.some(
                          (file) =>
                            file.path === selection.path && file.previousPath === findingFocus.path,
                        ))
                        ? findingFocus
                        : null
                    }
                  />
                </div>
              </div>
            </section>
          ) : view === 'review' ? (
            <ReviewWorkspace
              key={activeId}
              review={reviewInfo}
              state={reviewView}
              onViewChange={setReviewView}
              onLocate={locateCode}
              onFile={(path) => {
                setFindingFocus(null);
                if (reviewInfo?.latest)
                  setSelection({
                    scope: 'review',
                    path,
                    reviewId: reviewInfo.latest.id,
                    reviewScope,
                  });
              }}
            />
          ) : view === 'changes' ? (
            <section className="changes-panel">
              {(state.operation || state.locked || conflicts > 0) && (
                <div className="inline-warning">
                  <AlertTriangle size={15} />
                  {state.locked ? 'Git 索引被占用。' : ''}
                  {state.operation ? `仓库正在进行 ${state.operation}。` : ''}
                  {conflicts > 0 ? ` ${conflicts} 个文件存在冲突。` : ''}
                  请在外部处理后刷新，工具保留当前状态。
                  {state.operation === 'merge' && (
                    <>
                      <button
                        className="secondary"
                        disabled={!!busy || !!conflicts}
                        onClick={() => setGitOperation({ kind: 'continueMerge' })}
                      >
                        继续合并…
                      </button>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => setGitOperation({ kind: 'abortMerge' })}
                      >
                        中止合并…
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="changes-selection-prompt">
                <FileDiff size={28} />
                <h2>{state.files.length ? '选择左侧文件查看差异' : '没有本地改动'}</h2>
                <p>
                  {state.files.length
                    ? '未暂存与已暂存版本分别查看。'
                    : '修改文件后，改动会显示在左侧。'}
                </p>
              </div>
            </section>
          ) : (
            <section className="history-panel">
              <div className="history-heading history-controls">
                <div className="history-scope">
                  <span>
                    正在浏览：
                    {state.branches.find((branch) => branch.ref === historyRef)?.name ||
                      (historyRef ? '已失效分支' : '全部分支')}
                  </span>
                  {historyRef && (
                    <button className="text-button" onClick={() => setHistoryRef('')}>
                      全部历史
                    </button>
                  )}
                </div>
                <label className="history-search">
                  <Search size={14} />
                  <input
                    type="search"
                    aria-label="搜索提交历史"
                    placeholder="搜索说明、作者或哈希"
                    value={historySearch}
                    maxLength={200}
                    onChange={(event) => setHistorySearch(event.target.value)}
                  />
                </label>
                <span className="history-total">
                  {historyLoading
                    ? '正在查找…'
                    : `已加载 ${history.length} 条${historyHasMore ? ' · 还有更多' : historyQuery ? ' · 全部匹配结果' : ' · 当前范围已全部加载'}`}
                </span>
              </div>
              {historyError && (
                <p className="review-error history-error" role="alert">
                  {historyError}
                  <button
                    className="text-button"
                    onClick={() =>
                      history.length
                        ? void loadMoreHistory()
                        : setHistoryVersion((value) => value + 1)
                    }
                  >
                    重试
                  </button>
                </p>
              )}
              {!history.length ? (
                <div className="center-message">
                  <GitCommitHorizontal size={30} />
                  <h3>
                    {historyLoading
                      ? '正在读取历史…'
                      : historyError
                        ? '历史尚未加载'
                        : historyQuery
                          ? '没有匹配的提交'
                          : '当前范围没有提交'}
                  </h3>
                  <p>
                    {historyQuery
                      ? '搜索涵盖当前分支范围的全部历史，可修改关键词或返回全部历史。'
                      : '可选择其他分支，或在当前改动中创建首个提交。'}
                  </p>
                </div>
              ) : (
                <div
                  className="history-scroll"
                  ref={(element) => {
                    if (element) element.scrollTop = overviewScroll.current.history || 0;
                  }}
                  onScroll={(event) => {
                    overviewScroll.current.history = event.currentTarget.scrollTop;
                  }}
                >
                  <div
                    className="history-table"
                    style={{ '--graph-width': `${graph.width}px` } as React.CSSProperties}
                  >
                    <div className="history-columns">
                      <span>分支图</span>
                      <span>提交说明</span>
                      <span>作者</span>
                      <span>版本</span>
                    </div>
                    {history.map((item, index) => {
                      const row = graph.rows[index];
                      return (
                        <button
                          className={`commit-row ${selectedCommit === item.hash ? 'selected' : ''}`}
                          key={item.hash}
                          onClick={() => {
                            setSelectedCommit(item.hash);
                            setSelection(null);
                          }}
                          title={item.subject}
                        >
                          <svg
                            className="commit-graph"
                            width={graph.width}
                            height="62"
                            aria-hidden="true"
                          >
                            {row.edges.map((edge, edgeIndex) => {
                              const from = edge.from * 18 + 16,
                                to = edge.to * 18 + 16;
                              return (
                                <path
                                  key={edgeIndex}
                                  d={
                                    edge.current
                                      ? `M ${from} 31 C ${from} 46 ${to} 46 ${to} 62`
                                      : `M ${from} 0 L ${from} 20 C ${from} 42 ${to} 40 ${to} 62`
                                  }
                                  stroke={edge.color}
                                  strokeWidth="2"
                                  fill="none"
                                />
                              );
                            })}
                            {row.incoming && (
                              <path
                                d={`M ${row.lane * 18 + 16} 0 V 31`}
                                stroke={row.color}
                                strokeWidth="2"
                              />
                            )}
                            <circle
                              cx={row.lane * 18 + 16}
                              cy="31"
                              r={item.parents.length > 1 ? 5 : 4}
                              fill="#1a1f27"
                              stroke={row.color}
                              strokeWidth="2"
                            />
                          </svg>
                          <span className="commit-subject">
                            <span className="ref-list">
                              {item.refs.map((ref) => (
                                <span
                                  key={ref}
                                  className={`ref-tag ${ref.startsWith('HEAD') ? 'head-ref' : ''}`}
                                >
                                  {ref}
                                </span>
                              ))}
                            </span>
                            <strong>{item.subject}</strong>
                            <small>
                              {dateLabel(item.date)}
                              {item.parents.length > 1 ? ' · 合并提交' : ''}
                            </small>
                          </span>
                          <span className="commit-author">{item.author}</span>
                          <code className="commit-hash">{item.hash.slice(0, 7)}</code>
                        </button>
                      );
                    })}
                  </div>
                  {historyHasMore && (
                    <button
                      className="secondary history-load-more"
                      disabled={historyLoading}
                      onClick={() => void loadMoreHistory()}
                    >
                      {historyLoading ? '加载中…' : '继续加载更早提交'}
                    </button>
                  )}
                </div>
              )}
              <div className="history-hint">
                <GitBranch size={13} />
                {historyQuery
                  ? '搜索结果省略未匹配提交；浏览不会切换分支。'
                  : '浏览提交不会切换分支或修改工作区。'}
              </div>
            </section>
          )}
        </main>

        <aside className="detail-panel">
          {view !== 'history' ? (
            <>
              {view === 'changes' ? (
                <>
                  <CommitMessageComposer
                    key={`commit-message:${activeId}`}
                    repositoryId={activeId}
                    indexRevision={state?.indexRevision}
                    stagedCount={staged.length}
                    disabled={!!busy || !!conflicts || !!state?.operation}
                    draft={draft}
                    onChange={saveDraft}
                    onSettings={() => setSettingsOpen(true)}
                  />
                  <div className="commit-selection-summary">
                    <span>
                      仅提交已暂存的 <b>{staged.length}</b> 个文件
                    </span>
                  </div>
                  <button
                    className="primary preview-button"
                    ref={previewButton}
                    disabled={
                      !state || !!busy || !staged.length || !!state.operation || !!conflicts
                    }
                    onClick={() => void prepareCommit()}
                  >
                    {busy === '准备提交' ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <GitCommitHorizontal size={16} />
                    )}
                    预览提交
                    <ChevronRight size={15} />
                  </button>
                </>
              ) : (
                <>
                  <button className="secondary" onClick={() => selectView('changes')}>
                    <ArrowLeft size={14} />
                    返回提交准备
                  </button>
                </>
              )}
              {state && (
                <ReviewPanel
                  key={state.repositoryId}
                  repository={state}
                  settingsVersion={settingsVersion}
                  scope={reviewScope}
                  onScope={changeReviewScope}
                  onSettings={() => setSettingsOpen(true)}
                  onState={setReviewInfo}
                  workspaceOpen={view === 'review'}
                  onOpen={() => selectView('review')}
                />
              )}
            </>
          ) : (
            <>
              <div className="detail-heading">
                <GitCommitHorizontal size={17} />
                <h2>提交详情</h2>
              </div>
              {detailLoading ? (
                <div className="center-message compact">
                  <LoaderCircle className="spin" size={20} />
                  <p>读取提交…</p>
                </div>
              ) : commitDetails ? (
                <>
                  <div className="commit-detail-title">
                    <code>{commitDetails.commit.hash.slice(0, 12)}</code>
                    <h3>{commitDetails.commit.subject}</h3>
                    <span>
                      {commitDetails.commit.author} · {dateLabel(commitDetails.commit.date)}
                    </span>
                  </div>
                  <pre className="commit-message">{commitDetails.message}</pre>
                  {commitDetails.firstParentView && (
                    <div className="first-parent">
                      <GitMerge size={14} />
                      合并提交 · 第一父视角
                    </div>
                  )}
                  <div className="detail-files-heading">
                    改动文件 <span className="count">{commitDetails.files.length}</span>
                  </div>
                  <div className="history-files">
                    {commitDetails.files.map((file) => (
                      <button
                        key={file.path}
                        className={`history-file ${selection?.scope === 'commit' && selection.path === file.path ? 'selected' : ''}`}
                        title={
                          file.previousPath ? `${file.previousPath} → ${file.path}` : file.path
                        }
                        onClick={() =>
                          setSelection({
                            scope: 'commit',
                            commit: commitDetails.commit.hash,
                            path: file.path,
                          })
                        }
                      >
                        <span className={`file-status status-${file.status}`}>{file.status}</span>
                        <span>
                          {shortPath(file.path)}
                          <small>{directoryOf(file.path)}</small>
                        </span>
                        <ChevronRight size={12} />
                      </button>
                    ))}
                  </div>
                  <p className="hook-note">
                    {commitDetails.commit.parents.length
                      ? `比较父版本 ${commitDetails.commit.parents[0].slice(0, 8)} → 此提交`
                      : '根提交 · 相对空树查看全部新增内容'}
                  </p>
                </>
              ) : (
                <div className="center-message compact">
                  <GitCommitHorizontal size={24} />
                  <p>选择一个提交查看详情</p>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      <footer
        className="statusbar"
        title={
          updatedAt
            ? `刷新于 ${updatedAt.toLocaleTimeString('zh-CN', { hour12: false })}`
            : undefined
        }
      >
        <span>
          <span className={`live-dot ${busy ? 'amber' : ''}`} />
          {busy || (repository ? (state ? '已连接本地 Git' : '等待仓库状态') : '等待打开仓库')}
        </span>
      </footer>

      {settingsOpen && (
        <ModelSettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsVersion((value) => value + 1)}
        />
      )}
      {remotesOpen && activeId && (
        <RemoteSettingsDialog
          key={`remotes:${activeId}`}
          repositoryId={activeId}
          repositoryName={repository?.name || ''}
          onClose={() => {
            setRemotesOpen(false);
            setRemoteReturn(null);
          }}
          continueLabel={remoteReturn ? `继续${operationLabels[remoteReturn.kind]}` : undefined}
          onContinue={
            remoteReturn
              ? () => {
                  setRemotesOpen(false);
                  setGitOperation(remoteReturn);
                  setRemoteReturn(null);
                }
              : undefined
          }
          onChanged={() => void refresh(activeId, true)}
          onBusy={(value) => setBusy(value ? '更新远程仓库' : null)}
        />
      )}
      {gitOperation && activeId && (
        <GitOperationDialog
          repositoryId={activeId}
          initial={gitOperation}
          onClose={() => setGitOperation(null)}
          onBusy={(running) => setBusy(running ? operationLabels[gitOperation.kind] : null)}
          onManageRemotes={() => {
            setRemoteReturn(gitOperation);
            setGitOperation(null);
            setRemotesOpen(true);
          }}
          onFinished={(message, warning, nextState) => {
            if (nextState) {
              setState(nextState);
              setUpdatedAt(new Date());
            }
            if (message) {
              setSelection(null);
              setNotice({ kind: warning ? 'warning' : 'success', message: warning || message });
            }
            void refresh(activeId, true);
          }}
        />
      )}
      {previewOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setPreviewOpen(false);
          }}
        >
          <section
            className="commit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const elements = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>(
                  'button:not(:disabled),textarea:not(:disabled)',
                ),
              ];
              const first = elements[0],
                last = elements[elements.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="preview-title">确认这一次提交</h2>
              </div>
              <button
                className="icon-button"
                ref={closePreviewButton}
                disabled={!!busy}
                aria-label="关闭提交预览"
                onClick={() => {
                  setPreviewOpen(false);
                  previewButton.current?.focus();
                }}
              >
                <X size={19} />
              </button>
            </div>
            <p className="dialog-subtitle">只提交下列暂存内容。此按钮完成提交，不会推送。</p>
            <p className="review-advisory">
              AI 评审：
              {commitReviewInfo?.running && commitReviewInfo.runningScope === 'staged'
                ? '正在进行'
                : !commitReviewInfo?.latest
                  ? '尚未评审'
                  : commitReviewInfo.latest.stale ||
                      (preview && commitReviewInfo.latest.tree !== preview.tree)
                    ? '基于旧版本'
                    : `${commitReviewInfo.latest.findings.length} 个待人工核对的问题${commitReviewInfo.latest.skipped.length || commitReviewInfo.latest.unverifiedCount ? ' · 部分覆盖' : ''}`}
              。仅供参考，可以继续提交。
            </p>
            {preview ? (
              <>
                <div className="preview-target">
                  <GitBranch size={16} />
                  <strong>{preview.branch}</strong>
                  <ChevronRight size={14} />
                  <span>新提交</span>
                </div>
                <div className="preview-file-list">
                  {preview.files.map((file) => (
                    <div key={file.path}>
                      <span className={`file-status status-${file.indexStatus}`}>
                        {file.indexStatus}
                      </span>
                      <span>{file.path}</span>
                    </div>
                  ))}
                </div>
                <label htmlFor="preview-message" className="field-label">
                  提交说明
                </label>
                <textarea
                  id="preview-message"
                  className="preview-message"
                  value={draft}
                  disabled={!!busy}
                  onChange={(event) => saveDraft(event.target.value)}
                  spellCheck={false}
                />
                {preview.detached && (
                  <div className="inline-warning">
                    <AlertTriangle size={14} />
                    当前为游离 HEAD，新提交不会自动归入本地分支。
                  </div>
                )}
                {previewStale && (
                  <div className="inline-warning">
                    <AlertTriangle size={14} />
                    暂存内容或分支发生变化，请刷新预览。
                  </div>
                )}
              </>
            ) : (
              <div className="inline-warning">
                <AlertTriangle size={15} />
                旧预览已失效。草稿已保留，请重新生成预览。
              </div>
            )}
            {notice?.kind === 'error' && (
              <div className="dialog-error">
                <AlertCircle size={15} />
                <div>
                  {notice.message}
                  {notice.details && <pre>{notice.details}</pre>}
                </div>
              </div>
            )}
            <p className="dialog-note">
              Git 可能运行仓库配置的提交钩子。工具会保留真实结果，并核对实际提交内容。
            </p>
            <div className="dialog-actions">
              <button className="secondary" disabled={!!busy} onClick={() => setPreviewOpen(false)}>
                返回修改
              </button>
              {!preview || previewStale ? (
                <button className="primary" disabled={!!busy} onClick={() => void prepareCommit()}>
                  <RefreshCw size={14} />
                  刷新预览
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!!busy || !draft.trim()}
                  onClick={() => void commit()}
                >
                  {busy === '正在提交' ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <GitCommitHorizontal size={15} />
                  )}
                  {busy === '正在提交' ? '正在提交…' : `提交 ${preview.files.length} 个文件`}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
