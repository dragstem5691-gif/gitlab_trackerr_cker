import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  disabled?: boolean;
  onRun: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
}

export function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const enabled = actions.filter((a) => !a.disabled);
    if (!q) return enabled;
    return enabled.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        (a.hint && a.hint.toLowerCase().includes(q))
    );
  }, [actions, query]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[cursor];
      if (target) {
        target.onRun();
        onClose();
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search"
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <span className="text-[10px] font-mono text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
            Esc
          </span>
        </div>

        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-400">No matching actions</li>
          )}
          {filtered.map((action, idx) => (
            <li key={action.id}>
              <button
                type="button"
                onMouseEnter={() => setCursor(idx)}
                onClick={() => {
                  action.onRun();
                  onClose();
                }}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm transition ${
                  idx === cursor ? 'bg-sky-50 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{action.label}</div>
                  {action.hint && (
                    <div className="text-[11px] text-slate-400 truncate">{action.hint}</div>
                  )}
                </div>
                {action.shortcut && (
                  <span className="text-[10px] font-mono text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 shrink-0">
                    {action.shortcut}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
