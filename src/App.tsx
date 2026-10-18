import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Settings2,
  Circle,
  FileCode2,
  FileDiff,
  Files,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
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
import type {
  ChangeFile,
  Commit,
  CommitDetails,
  CommitPreview,
  DiffResult,
  DiffSelection,
  RepositoryState,
  Workspace,
  Finding,
  ReviewState,
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
  const [view, setView] = useState<'changes' | 'history'>('changes');
  const [selection, setSelection] = useState<DiffSelection | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [history, setHistory] = useState<Commit[]>([]);
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
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [reviewInfo, setReviewInfo] = useState<ReviewState | null>(null);
  const [findingFocus, setFindingFocus] = useState<Finding | null>(null);
  const activeId = workspace?.activeRepositoryId || null;
  const repository = workspace?.repositories.find((item) => item.id === activeId);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const refreshCounter = useRef(0);
  const historyKey = useRef('');
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
        const commits = await api.history(id);
        if (activeIdRef.current !== id || request !== refreshCounter.current) return;
        historyKey.current = key;
        setHistory(commits);
        setSelectedCommit((selected) =>
          selected && commits.some((commit) => commit.hash === selected)
            ? selected
            : commits[0]?.hash || null,
        );
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
    setSelectedCommit(null);
    setCommitDetails(null);
    setSelection(null);
    setDiff(null);
    setPreview(null);
    setPreviewOpen(false);
    setReviewInfo(null);
    setFindingFocus(null);
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
    if (!activeId || !selection) {
      setDiff(null);
      return;
    }
    let disposed = false;
    setDiffLoading(true);
    api
      .diff(activeId, selection)
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

  function selectView(next: 'changes' | 'history') {
    setView(next);
    setSelection(null);
    setDiff(null);
  }
  function selectHistory(commitHash: string) {
    selectView('history');
    setSelectedCommit(commitHash);
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
                    onClick={() => setSelection({ scope, path: file.path })}
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <GitBranch size={23} strokeWidth={2.2} />
          <span>CodeGuard</span>
          <span className="version">0.1</span>
        </div>
        <div className="repository-picker">
          <FolderGit2 size={16} />
          <select
            aria-label="当前仓库"
            value={activeId || ''}
            disabled={!!busy || !workspace?.repositories.length}
            onChange={(event) => void switchRepository(event.target.value)}
          >
            {!workspace?.repositories.length && <option value="">选择本地仓库</option>}
            {workspace?.repositories.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {state && (
          <span className="current-branch">
            <GitBranch size={13} />
            {state.detached ? `HEAD · ${state.head?.slice(0, 8)}` : state.branch}
          </span>
        )}
        <div className="toolbar">
          <span className={`local-label ${api.mode === 'fixture' ? 'fixture-label' : ''}`}>
            {api.mode === 'fixture' ? '临时仓库 · 开发预览' : '本地 Git 工作台'}
          </span>
          <button
            className="toolbar-button"
            disabled={!!busy || !activeId || loading}
            onClick={() => activeId && void refresh(activeId)}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
          <button
            className="toolbar-button"
            disabled={!!busy}
            onClick={() => void pickRepository()}
          >
            <FolderOpen size={15} />
            打开仓库
          </button>
          <button className="toolbar-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={15} />
            模型设置
          </button>
        </div>
      </header>

      <div className="body-layout">
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="section-caption">工作区</div>
            <button
              className={`nav-item ${view === 'changes' ? 'active' : ''}`}
              onClick={() => selectView('changes')}
            >
              <Files size={15} />
              <span>当前改动</span>
              <span className="nav-count">{state?.files.length || 0}</span>
            </button>
            <button
              className={`nav-item ${view === 'history' ? 'active' : ''}`}
              onClick={() => selectView('history')}
            >
              <History size={15} />
              <span>提交历史</span>
            </button>
          </div>
          <div className="sidebar-section">
            <div className="section-caption">
              本地分支 <span>浏览</span>
            </div>
            {state?.branches
              .filter((branch) => !branch.remote)
              .map((branch) => (
                <button
                  key={branch.name}
                  className={`branch-item ${branch.current ? 'current' : ''}`}
                  onClick={() => selectHistory(branch.hash)}
                  title={branch.name}
                >
                  <span className={`branch-dot ${branch.current ? 'purple' : 'green'}`} />
                  <span>{branch.name}</span>
                  {branch.current && <Check size={12} />}
                </button>
              ))}
            {state && !state.branches.some((branch) => !branch.remote) && (
              <p className="sidebar-hint">首个提交后显示分支</p>
            )}
          </div>
          {!!state?.branches.some((branch) => branch.remote) && (
            <div className="sidebar-section">
              <div className="section-caption">远端分支</div>
              {state.branches
                .filter((branch) => branch.remote)
                .map((branch) => (
                  <button
                    key={branch.name}
                    className="branch-item"
                    onClick={() => selectHistory(branch.hash)}
                    title={branch.name}
                  >
                    <span className="branch-dot blue" />
                    <span>{branch.name}</span>
                  </button>
                ))}
            </div>
          )}
          <div className="sidebar-bottom">
            {repository && (
              <>
                <p className="repository-root" title={repository.root}>
                  {repository.root}
                </p>
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
            <div className="phase-note">
              <span className="phase-dot" />
              Git 工作台 · AI 评审
            </div>
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
            <span className="tab-right">
              {view === 'history' ? '最近 150 条 · 所有本地引用' : '全部本地改动'}
            </span>
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
              <span className="eyebrow">YOUR CHANGES, IN FOCUS</span>
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
                  {view === 'history' ? '返回历史' : '返回概览'}
                </button>
                <span className={`scope-chip ${selection.scope === 'index' ? 'mint' : ''}`}>
                  {selection.scope === 'index'
                    ? '已暂存 · 本次提交'
                    : selection.scope === 'commit'
                      ? `提交 ${selection.commit?.slice(0, 8)}`
                      : '未暂存 · 工作区'}
                </span>
              </div>
              <div className="diff-title">
                <FileDiff size={17} />
                <h2 title={selection.path}>{selection.path}</h2>
              </div>
              <DiffView
                diff={diff}
                loading={diffLoading}
                focus={
                  selection?.scope === 'index' &&
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
            </section>
          ) : view === 'changes' ? (
            <section className="changes-panel">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">WORKING DIRECTORY</span>
                  <h1>
                    {state.files.length ? '把改动整理成一次清楚的提交' : '工作区干净，一切就绪'}
                  </h1>
                  <p>
                    {state.files.length
                      ? '先查看全部改动，再选择本次提交内容。'
                      : state.head
                        ? '可以切换到提交历史，查看已有改动。'
                        : '这是一个空仓库，添加文件后即可创建首个提交。'}
                  </p>
                </div>
                <div className={`state-orb ${state.files.length ? 'changed' : ''}`}>
                  {state.files.length ? <Files size={25} /> : <Check size={26} />}
                </div>
              </div>
              {(state.operation || state.locked || conflicts > 0) && (
                <div className="inline-warning">
                  <AlertTriangle size={15} />
                  {state.locked ? 'Git 索引被占用。' : ''}
                  {state.operation ? `仓库正在进行 ${state.operation}。` : ''}
                  {conflicts > 0 ? ` ${conflicts} 个文件存在冲突。` : ''}
                  请在外部处理后刷新，工具保留当前状态。
                </div>
              )}
              <div className="summary-cards">
                <div>
                  <span>本地改动</span>
                  <strong>
                    {state.files.length}
                    <small>个文件</small>
                  </strong>
                </div>
                <div className="staged-card">
                  <span>本次提交</span>
                  <strong>
                    {staged.length}
                    <small>个文件</small>
                  </strong>
                </div>
                <div>
                  <span>未跟踪</span>
                  <strong>
                    {untracked.length}
                    <small>个文件</small>
                  </strong>
                </div>
              </div>
              <div className="list-heading">
                <h2>改动文件</h2>
                <span>同一文件可以同时有暂存和未暂存内容</span>
              </div>
              {fileGroup('未暂存', unstaged, 'worktree', 'unstaged')}
              {fileGroup('已暂存', staged, 'index', 'staged')}
              {fileGroup('未跟踪', untracked, 'worktree', 'untracked')}
              <div className="quiet-note">
                <Circle size={6} fill="currentColor" />
                点击文件查看差异；右侧 ＋ / − 只改变暂存状态。
              </div>
            </section>
          ) : (
            <section className="history-panel">
              <div className="history-heading">
                <div>
                  <span className="eyebrow">COMMIT HISTORY</span>
                  <h1>沿着分支，查看每一次变化</h1>
                </div>
                <span className="history-total">{history.length} 个提交</span>
              </div>
              {!history.length ? (
                <div className="center-message">
                  <GitCommitHorizontal size={30} />
                  <h3>还没有提交</h3>
                  <p>在当前改动中暂存文件，创建首个提交。</p>
                </div>
              ) : (
                <div className="history-scroll">
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
                </div>
              )}
              <div className="history-hint">
                <GitBranch size={13} />
                浏览提交不会切换分支或修改工作区。
              </div>
            </section>
          )}
        </main>

        <aside className="detail-panel">
          {view === 'changes' ? (
            <>
              <div className="detail-heading">
                <GitCommitHorizontal size={17} />
                <h2>本次提交</h2>
                <span className="count">{staged.length}</span>
              </div>
              <div className="target-box">
                <span>提交到当前分支</span>
                <strong>
                  <GitBranch size={13} />
                  {state?.detached
                    ? `游离 HEAD · ${state.head?.slice(0, 8)}`
                    : state?.branch || '尚未选择仓库'}
                </strong>
              </div>
              <div className="composition">
                <label htmlFor="commit-message">提交说明</label>
                <textarea
                  id="commit-message"
                  value={draft}
                  onChange={(event) => saveDraft(event.target.value)}
                  disabled={!activeId || !!busy}
                  placeholder={'简短说明这次改动\n\n必要时补充原因和验证说明。'}
                  spellCheck={false}
                />
                <div className="draft-caption">
                  <span>{draft ? '草稿保存在本地' : '说明由你填写'}</span>
                  <span>{draft.length} 字</span>
                </div>
              </div>
              <div className="commit-selection-summary">
                <span>
                  已暂存 <b>{staged.length}</b> 个文件
                </span>
                {unstaged.length > 0 && <small>未暂存的编辑不会进入提交</small>}
              </div>
              <button
                className="primary preview-button"
                ref={previewButton}
                disabled={!state || !!busy || !staged.length || !!state.operation || !!conflicts}
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
              <p className="hook-note">
                提交遵循仓库现有的钩子与签名设置。失败时保留草稿，并显示 Git 的真实错误。
              </p>
              {state && (
                <ReviewPanel
                  key={state.repositoryId}
                  repository={state}
                  settingsVersion={settingsVersion}
                  onSettings={() => setSettingsOpen(true)}
                  onState={setReviewInfo}
                  onLocate={(finding) => {
                    setFindingFocus(finding);
                    const file = state.files.find(
                      (item) => item.path === finding.path || item.previousPath === finding.path,
                    );
                    setSelection({ scope: 'index', path: file?.path || finding.path });
                  }}
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
          {state && (
            <div className="repository-status">
              <div className="section-caption">仓库状态</div>
              <div>
                <span>当前分支</span>
                <b>{state.detached ? '游离 HEAD' : state.branch}</b>
              </div>
              <div>
                <span>上游</span>
                <b>{state.upstream || '未设置'}</b>
              </div>
              <div>
                <span>领先 / 落后</span>
                <b>
                  <ArrowUp size={11} />
                  {state.ahead}
                  <ArrowDown size={11} />
                  {state.behind}
                </b>
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span>
          <span className={`live-dot ${busy ? 'amber' : ''}`} />
          {busy || (repository ? (state ? '已连接本地 Git' : '等待仓库状态') : '等待打开仓库')}
        </span>
        {state && (
          <span>
            <GitBranch size={12} />
            {state.detached ? 'HEAD detached' : state.branch}
          </span>
        )}
        {state && (
          <span>
            {staged.length} 个已暂存 · {state.files.length} 个改动文件
          </span>
        )}
        <span className="status-right">
          {updatedAt && `刷新于 ${updatedAt.toLocaleTimeString('zh-CN', { hour12: false })}`}
          <span className="status-divider" />
          本地操作 · 不自动推送
        </span>
      </footer>

      {settingsOpen && (
        <ModelSettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsVersion((value) => value + 1)}
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
                <span className="eyebrow">COMMIT PREVIEW</span>
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
              {reviewInfo?.running
                ? '正在进行'
                : !reviewInfo?.latest
                  ? '尚未评审'
                  : reviewInfo.latest.stale || (preview && reviewInfo.latest.tree !== preview.tree)
                    ? '基于旧版本'
                    : `${reviewInfo.latest.findings.length} 个待人工核对的问题${reviewInfo.latest.skipped.length || reviewInfo.latest.unverifiedCount ? ' · 部分覆盖' : ''}`}
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
