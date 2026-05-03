import { useEffect, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarRange,
  ChevronRight,
  Clock4,
  Command,
  KanbanSquare,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { AppPage } from '../lib/navigation';

interface Props {
  page: AppPage;
  onChangePage: (p: AppPage) => void;
  canOpenReport: boolean;
  canOpenPlanning: boolean;
  breadcrumb: string[];
  gitLabStatus: 'connected' | 'disconnected' | 'demo';
  gitLabLabel: string;
  onOpenConnection: () => void;
  onOpenCommandPalette: () => void;
  children: ReactNode;
}

const TAB_META: Record<AppPage, { label: string; icon: ReactNode; shortcut: string }> = {
  report: { label: 'Report', icon: <BarChart3 className="w-4 h-4" />, shortcut: 'Alt+1' },
  planning: { label: 'Planning', icon: <KanbanSquare className="w-4 h-4" />, shortcut: 'Alt+2' },
  ganttBuilder: {
    label: 'Gantt Builder',
    icon: <CalendarRange className="w-4 h-4" />,
    shortcut: 'Alt+3',
  },
};

export function AppShell({
  page,
  onChangePage,
  canOpenReport,
  canOpenPlanning,
  breadcrumb,
  gitLabStatus,
  gitLabLabel,
  onOpenConnection,
  onOpenCommandPalette,
  children,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.key === '1' && canOpenReport) {
          e.preventDefault();
          onChangePage('report');
        } else if (e.key === '2' && canOpenPlanning) {
          e.preventDefault();
          onChangePage('planning');
        } else if (e.key === '3') {
          e.preventDefault();
          onChangePage('ganttBuilder');
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenCommandPalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onChangePage, onOpenCommandPalette, canOpenReport, canOpenPlanning]);

  const tabs: AppPage[] = ['report', 'planning', 'ganttBuilder'];

  const disabledFor = (p: AppPage) => {
    if (p === 'report') return !canOpenReport;
    if (p === 'planning') return !canOpenPlanning;
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-900 to-sky-700 text-white flex items-center justify-center shadow-sm">
              <Clock4 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-900 leading-tight truncate">
                GitLab Time Tracking Report
              </h1>
              {breadcrumb.length > 0 && (
                <nav
                  aria-label="Breadcrumb"
                  className="flex items-center gap-1 text-[11px] text-slate-500 truncate"
                >
                  {breadcrumb.map((crumb, idx) => (
                    <span key={`${crumb}-${idx}`} className="inline-flex items-center gap-1">
                      {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                      <span
                        className={
                          idx === breadcrumb.length - 1
                            ? 'text-slate-700 font-medium'
                            : 'text-slate-500'
                        }
                      >
                        {crumb}
                      </span>
                    </span>
                  ))}
                </nav>
              )}
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {tabs.map((p) => {
              const active = page === p;
              const disabled = disabledFor(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => !disabled && onChangePage(p)}
                  disabled={disabled}
                  title={`${TAB_META[p].label} (${TAB_META[p].shortcut})`}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : disabled
                      ? 'text-slate-300 cursor-not-allowed'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {TAB_META[p].icon}
                  {TAB_META[p].label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenCommandPalette}
              title="Command palette (Ctrl/Cmd+K)"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-500 hover:text-slate-800 hover:border-slate-300 transition"
            >
              <Command className="w-3.5 h-3.5" />
              <span className="font-mono">K</span>
            </button>
            <button
              type="button"
              onClick={onOpenConnection}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition ${
                gitLabStatus === 'connected'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                  : gitLabStatus === 'demo'
                  ? 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {gitLabStatus === 'connected' ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : gitLabStatus === 'demo' ? (
                <ShieldCheck className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              <span className="max-w-[200px] truncate">{gitLabLabel}</span>
            </button>
          </div>
        </div>

        <div className="md:hidden max-w-[1440px] mx-auto px-4 pb-2 flex gap-1">
          {tabs.map((p) => {
            const active = page === p;
            const disabled = disabledFor(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => !disabled && onChangePage(p)}
                disabled={disabled}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition ${
                  active
                    ? 'bg-slate-900 text-white'
                    : disabled
                    ? 'bg-slate-50 text-slate-300'
                    : 'bg-white border border-slate-200 text-slate-600'
                }`}
              >
                {TAB_META[p].icon}
                {TAB_META[p].label}
              </button>
            );
          })}
        </div>
      </header>

      {children}

      <footer className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 text-center text-[11px] text-slate-400">
        Your GitLab token is kept only in this browser tab&apos;s sessionStorage and never sent
        anywhere except to your GitLab instance.
      </footer>
    </div>
  );
}
