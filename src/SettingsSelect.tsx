import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export function SettingsSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = Math.max(
    0,
    options.findIndex((item) => item.value === value),
  );
  function choose(index: number) {
    if (!options[index] || disabled) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  function keydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setHighlight(
        !open
          ? event.key === 'End'
            ? options.length - 1
            : selected
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : (highlight + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                options.length,
      );
      setOpen(true);
    } else if (open && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      choose(highlight);
    }
  }
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [open]);
  return (
    <div className="settings-field" ref={wrapper} onKeyDownCapture={keydown}>
      <span id={`${id}-label`}>{label}</span>
      <div className="settings-select">
        <button
          ref={trigger}
          type="button"
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-activedescendant={open ? `${id}-${highlight}` : undefined}
          disabled={disabled}
          onBlur={(event) => {
            if (!wrapper.current?.contains(event.relatedTarget as Node)) setOpen(false);
          }}
          onClick={() => {
            setHighlight(selected);
            setOpen(!open);
          }}
        >
          <span>{options[selected]?.label}</span>
          <ChevronDown size={15} />
        </button>
        {open && !disabled && (
          <div id={id} role="listbox" aria-labelledby={`${id}-label`} className="settings-options">
            {options.map((item, index) => (
              <div
                key={item.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={item.value === value}
                className={index === highlight ? 'highlighted' : ''}
                onPointerMove={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{item.label}</span>
                {item.value === value && <Check size={15} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
