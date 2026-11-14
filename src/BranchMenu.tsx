import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  GitMerge,
  Globe,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { Branch, GitOperationRequest, RepositoryState } from './types';

export function BranchMenu({
  state,
  disabled,
  onOperation,
  onHistory,
}: {
  state: RepositoryState;
  disabled: boolean;
  onOperation: (request: GitOperationRequest) => void;
  onHistory: (branch: Branch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapper = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const locals = state.branches
    .filter((b) => !b.remote && !b.symbolic)
    .sort((a, b) => Number(b.current) - Number(a.current));
  const remotes = state.branches.filter((b) => b.remote && !b.symbolic);
  const matches = (b: Branch) =>
    b.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const localMatches = locals.filter(matches).sort((a, b) => Number(b.current) - Number(a.current));
  const remoteMatches = remotes.filter(matches),
    blocked = !!state.operation;
  useEffect(() => {
    if (!open) return;
    setQuery('');
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  function operation(request: GitOperationRequest) {
    setOpen(false);
    onOperation(request);
  }
  function row(branch: Branch) {
    // Only exact upstream refs associate local and remote branches.
    const tracked = branch.remote
      ? locals.find(
          (local) =>
            local.upstreamRef === branch.ref ||
            (local.current && state.upstream && `refs/remotes/${state.upstream}` === branch.ref),
        )
      : undefined;
    const isCurrent = branch.current || !!tracked?.current;
    return (
      <div className={`branch-menu-row ${branch.current ? 'is-current' : ''}`} key={branch.ref}>
        <button
          className="branch-name"
          title={`浏览 ${branch.name} 历史，不切换工作分支`}
          aria-label={`浏览 ${branch.name} 历史`}
          onClick={() => {
            setOpen(false);
            onHistory(branch);
          }}
        >
          <span className={`branch-row-icon ${branch.remote ? 'remote' : ''}`}>
            {branch.remote ? <Globe size={15} /> : <GitBranch size={15} />}
          </span>
          <span className="branch-row-name">
            <strong>{branch.name}</strong>
            {tracked && !tracked.current && <small>本地跟踪：{tracked.name}</small>}
            {branch.current && <small>当前工作分支</small>}
            {tracked?.current && <small>当前分支的上游</small>}
          </span>
        </button>
        {isCurrent ? (
          <span className="branch-current-badge">
            <Check size={12} />
            {branch.current ? '已检出' : '已跟踪'}
          </span>
        ) : (
          <div className="branch-menu-actions">
            <button
              className="branch-switch-action"
              disabled={blocked || !state.head}
              title={
                tracked
                  ? `切换到已有本地分支 ${tracked.name}`
                  : branch.remote
                    ? '创建本地跟踪分支并切换'
                    : '切换工作分支'
              }
              onClick={() =>
                operation(
                  tracked
                    ? { kind: 'switch', source: tracked.ref }
                    : branch.remote
                      ? { kind: 'checkout', source: branch.ref }
                      : { kind: 'switch', source: branch.ref },
                )
              }
            >
              {branch.remote && !tracked ? '检出…' : '切换'}
            </button>
            <button
              className="branch-merge-action"
              disabled={blocked || state.detached}
              title={`将 ${branch.name} 合并到 ${state.branch}`}
              aria-label={`将 ${branch.name} 合并到 ${state.branch}`}
              onClick={() => operation({ kind: 'merge', source: branch.ref })}
            >
              <GitMerge size={13} />
              合并…
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className="branch-picker"
      ref={wrapper}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
          return;
        }
        if (event.target instanceof HTMLInputElement) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            menu.current
              ?.querySelector<HTMLButtonElement>('.branch-list button:not(:disabled)')
              ?.focus();
          }
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const items = [
            ...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []),
          ];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          ]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="current-branch"
        disabled={disabled}
        aria-label="分支菜单"
        aria-description={`当前检出 ${state.branch}；菜单可新建、检出、切换或合并分支`}
        title={`当前检出：${state.branch}`}
        aria-expanded={open}
        aria-controls={open ? 'branch-menu' : undefined}
        onClick={() => setOpen(!open)}
      >
        <GitBranch size={13} />
        <small className="checked-out-label">当前检出</small>
        <span>{state.detached ? `HEAD · ${state.head?.slice(0, 8)}` : state.branch}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          id="branch-menu"
          ref={menu}
          className="branch-menu"
          role="region"
          aria-label="分支管理"
        >
          <header className="branch-menu-header">
            <div>
              <strong>分支管理</strong>
              <small>选择工作分支，或查看分支历史</small>
            </div>
            <button
              className="branch-create-button"
              disabled={blocked || !state.head}
              onClick={() => operation({ kind: 'createBranch' })}
            >
              <Plus size={15} />
              新建分支
            </button>
          </header>
          {state.operation === 'merge' && (
            <div className="branch-recovery">
              <button onClick={() => operation({ kind: 'continueMerge' })}>继续合并</button>
              <button onClick={() => operation({ kind: 'abortMerge' })}>中止合并…</button>
            </div>
          )}
          <label className="branch-search">
            <Search size={15} />
            <input
              ref={search}
              aria-label="搜索分支"
              placeholder="搜索本地或远端分支…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                aria-label="清除分支搜索"
                onClick={() => {
                  setQuery('');
                  search.current?.focus();
                }}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <div className="branch-list">
            <section aria-label="本地分支">
              <div className="branch-section-heading">
                <span>
                  本地分支 <small>{localMatches.length}</small>
                </span>
              </div>
              {localMatches.map(row)}
              {!localMatches.length && (
                <p className="branch-empty">
                  {query
                    ? '没有匹配的本地分支'
                    : state.head
                      ? '尚无本地分支'
                      : '首个提交后可创建分支'}
                </p>
              )}
            </section>
            <section aria-label="远端分支">
              <div className="branch-section-heading">
                <span>
                  远端分支 <small>{remoteMatches.length}</small>
                </span>
                <button
                  disabled={blocked}
                  title="获取远端的最新分支和提交"
                  onClick={() => operation({ kind: 'fetch' })}
                >
                  <RefreshCw size={12} />
                  获取更新
                </button>
              </div>
              {remoteMatches.map(row)}
              {!remoteMatches.length && (
                <p className="branch-empty">
                  {query ? '没有匹配的远端分支' : '获取更新后，远端分支会显示在这里'}
                </p>
              )}
            </section>
          </div>
          <footer className="branch-menu-footer">
            <button
              disabled={blocked || !state.head}
              onClick={() => operation({ kind: 'checkout' })}
            >
              <ArrowDownToLine size={15} />
              <span>按名称检出远端分支</span>
              <ArrowRight size={13} />
            </button>
            <p>点击分支名查看历史 · 切换与合并将单独确认</p>
          </footer>
        </div>
      )}
    </div>
  );
}
