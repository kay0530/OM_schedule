import { useState, useRef, useEffect } from 'react';

/**
 * Compact filter trigger + checkbox popover used in the one-row toolbar.
 * Stays open across toggles (popover, not dropdown) so multiple items can be
 * checked in one visit; closes on outside mousedown, Escape, or dragstart.
 *
 * @param {{
 *   label: string,
 *   items: Array<{ id: string, label: string, color?: string, checked: boolean }>,
 *   onToggle: (id: string) => void,
 *   onToggleAll: () => void,
 *   allChecked: boolean,
 * }}
 */
export default function FilterPopover({ label, items, onToggle, onToggleAll, allChecked }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onDragStart() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('dragstart', onDragStart);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('dragstart', onDragStart);
    };
  }, [open]);

  const checkedCount = items.filter((i) => i.checked).length;
  const filtered = checkedCount < items.length;
  // Up to 5 color dots of currently checked items as a glanceable summary
  const dotColors = items.filter((i) => i.checked && i.color).slice(0, 5).map((i) => i.color);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
          filtered
            ? 'border-accent/50 bg-accent-soft text-accent font-medium'
            : 'border-edge bg-surface text-ink-muted hover:bg-surface-hover'
        }`}
        title={`${label}フィルター`}
      >
        {dotColors.length > 0 && (
          <span className="flex -space-x-1">
            {dotColors.map((c, i) => (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full ring-1 ring-surface"
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
        )}
        {label}
        <span className={filtered ? '' : 'text-ink-faint'}>
          {checkedCount}/{items.length}
        </span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 z-40 w-56 bg-raised border border-edge rounded-lg shadow-lg p-2 max-h-80 overflow-y-auto">
          <button
            type="button"
            onClick={onToggleAll}
            className="w-full text-left text-xs px-2 py-1.5 rounded-md text-accent hover:bg-surface-hover font-medium"
          >
            {allChecked ? '全解除' : '全選択'}
          </button>
          <div className="border-t border-edge my-1" />
          {items.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover cursor-pointer text-xs text-ink"
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => onToggle(item.id)}
                className="w-3.5 h-3.5 rounded"
                style={{ accentColor: 'var(--accent)' }}
              />
              {item.color && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              )}
              <span className="truncate">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
