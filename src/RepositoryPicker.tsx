import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FolderGit2, Globe } from 'lucide-react';
import type { Repository } from './types';

export function RepositoryPicker({
  repositories,
  activeId,
  disabled,
  onSelect,
  onManageRemotes,
}: {
  repositories: Repository[];
  activeId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onManageRemotes: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = repositories.find((item) => item.id === activeId);
  const unavailable = disabled || !repositories.length;

  function show(
    index = Math.max(
      0,
      repositories.findIndex((item) => item.id === activeId),
    ),
  ) {
    if (unavailable || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      width,
    });
    setHighlight(index);
    setOpen(true);
  }
  function choose(index: number) {
    const item = repositories[index];
    if (!item || unavailable) return;
    setOpen(false);
    trigger.current?.focus();
    onSelect(item.id);
  }
  function keydown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      if (open && !event.shiftKey && selected) {
        event.preventDefault();
        document.getElementById(`${listId}-manage`)?.focus();
        return;
      }
      setOpen(false);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show(event.key === 'End' ? repositories.length - 1 : undefined);
        return;
      }
      setHighlight((index) =>
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? repositories.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + repositories.length) %
              repositories.length,
      );
    } else if (open && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      choose(highlight);
    }
  }
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listId]);

  return (
    <div className="repository-picker">
      <button
        ref={trigger}
        type="button"
        className="repository-trigger"
        role="combobox"
        aria-label="当前仓库"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        disabled={unavailable}
        title={selected?.root}
        onKeyDown={keydown}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <FolderGit2 size={16} />
        <span>{selected?.name || '选择本地仓库'}</span>
        <ChevronDown
          size={14}
          className={open ? 'repository-chevron open' : 'repository-chevron'}
        />
      </button>
      {open &&
        !unavailable &&
        createPortal(
          <div
            ref={menu}
            className="repository-menu"
            style={{ ...position, maxHeight: `calc(100vh - ${position.top + 12}px)` }}
          >
            <div className="repository-menu-caption">
              切换仓库<span>{repositories.length}</span>
            </div>
            <div id={listId} role="listbox" aria-label="仓库列表" className="repository-options">
              {repositories.map((item, index) => (
                <div
                  key={item.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={item.id === activeId}
                  className={`repository-option${index === highlight ? ' highlighted' : ''}`}
                  onPointerMove={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <FolderGit2 size={16} />
                  <span>
                    <strong>{item.name}</strong>
                    <small title={item.root}>{item.root}</small>
                  </span>
                  {item.id === activeId && <Check size={14} className="repository-check" />}
                </div>
              ))}
            </div>
            <button
              id={`${listId}-manage`}
              className="repository-manage-remotes"
              disabled={!selected}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  trigger.current?.focus();
                }
              }}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                onManageRemotes();
              }}
            >
              <Globe size={15} />
              远程仓库管理
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
