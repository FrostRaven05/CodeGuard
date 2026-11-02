import { useEffect, useRef, useState } from 'react';
import { ChevronDown, GitBranch } from 'lucide-react';
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
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
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
        aria-description={`当前检出 ${state.branch}；菜单可切换或合并分支`}
        title={`当前检出：${state.branch}；打开菜单切换或合并分支`}
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
        <div id="branch-menu" ref={menu} className="branch-menu">
          {state.operation === 'merge' && (
            <div className="branch-recovery">
              <button onClick={() => operation({ kind: 'continueMerge' })}>继续合并</button>
              <button onClick={() => operation({ kind: 'abortMerge' })}>中止合并…</button>
            </div>
          )}
          <p className="branch-menu-caption">
            分支 <span>切换 / 合并到 {state.branch}</span>
          </p>
          {state.branches
            .filter((b) => !b.symbolic)
            .map((b) => (
              <div className="branch-menu-row" key={b.ref}>
                <button
                  className="branch-name"
                  title={`浏览 ${b.name} 历史，不切换工作分支`}
                  aria-label={`浏览 ${b.name} 历史`}
                  onClick={() => {
                    setOpen(false);
                    onHistory(b);
                  }}
                >
                  <span
                    className={`branch-dot ${b.current ? 'purple' : b.remote ? 'blue' : 'green'}`}
                  />
                  <span>
                    {b.name}
                    {b.current && <small>当前检出</small>}
                  </span>
                </button>
                {!b.current && (
                  <div className="branch-menu-actions">
                    {!b.remote && (
                      <button
                        disabled={!!state.operation}
                        onClick={() => operation({ kind: 'switch', source: b.ref })}
                      >
                        切换
                      </button>
                    )}
                    <button
                      disabled={!!state.operation || state.detached}
                      onClick={() => operation({ kind: 'merge', source: b.ref })}
                    >
                      合并…
                    </button>
                  </div>
                )}
              </div>
            ))}
          {!state.branches.length && <p className="field-help">首个提交后显示分支。</p>}
        </div>
      )}
    </div>
  );
}
