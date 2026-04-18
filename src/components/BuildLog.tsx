import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
  Terminal,
  AlertTriangle,
  XCircle,
  Zap,
} from 'lucide-react';
import type { LogEntry, LogLevel } from '../lib/logger';

interface Props {
  entries: LogEntry[];
  isRunning: boolean;
  defaultOpen?: boolean;
}

const levelIcon: Record<LogLevel, JSX.Element> = {
  info: <Info className="w-3.5 h-3.5 text-sky-600" />,
  success: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
  error: <XCircle className="w-3.5 h-3.5 text-rose-600" />,
  phase: <Zap className="w-3.5 h-3.5 text-slate-900" />,
};

const levelBg: Record<LogLevel, string> = {
  info: 'bg-sky-50',
  success: 'bg-emerald-50',
  warning: 'bg-amber-50',
  error: 'bg-rose-50',
  phase: 'bg-slate-100',
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function BuildLog({ entries, isRunning, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current && open) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, open]);

  const handleCopy = async () => {
    const text = entries
      .map(
        (e) =>
          `[${formatElapsed(e.elapsedMs).padStart(8)}] ${e.level.toUpperCase().padEnd(7)} ${e.message}${
            e.meta ? ' ' + JSON.stringify(e.meta) : ''
          }`
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const counts = useMemo(
    () =>
      entries.reduce(
        (acc, e) => {
          acc[e.level] = (acc[e.level] || 0) + 1;
          return acc;
        },
        {} as Record<LogLevel, number>
      ),
    [entries]
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <Terminal className="w-4 h-4" />
          </div>
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">Build log</span>
              {isRunning && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
                  </span>
                  running
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500 truncate">
              <span>{entries.length} event(s)</span>
              {counts.success ? <span>{counts.success} ok</span> : null}
              {counts.warning ? (
                <span className="text-amber-700">{counts.warning} warn</span>
              ) : null}
              {counts.error ? <span className="text-rose-700">{counts.error} err</span> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              Copy
            </span>
          )}
          {open ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="max-h-80 overflow-y-auto border-t border-slate-200 bg-slate-50/50"
        >
          {entries.length === 0 && (
            <div className="px-5 py-8 text-center text-xs text-slate-500">
              No events yet. Build a report to see collection details.
            </div>
          )}
          <ul className="divide-y divide-slate-100 font-mono text-[12px] leading-relaxed">
            {entries.map((e) => (
              <li
                key={e.id}
                className={`flex items-start gap-2 px-4 py-1.5 ${levelBg[e.level]}`}
              >
                <span className="shrink-0 w-16 text-right text-slate-500 tabular-nums">
                  {formatElapsed(e.elapsedMs)}
                </span>
                <span className="shrink-0 mt-0.5">{levelIcon[e.level]}</span>
                <span
                  className={`flex-1 break-words ${
                    e.level === 'phase'
                      ? 'font-bold text-slate-900 uppercase tracking-wide text-[11px]'
                      : 'text-slate-800'
                  }`}
                >
                  {e.message}
                  {e.meta && (
                    <span className="ml-2 text-slate-500">
                      {Object.entries(e.meta)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(' ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
