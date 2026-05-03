import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
  badge?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function ActivityDrawer({ title, subtitle, badge, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-6 py-2 hover:bg-slate-50 transition"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="text-xs font-semibold text-slate-800">{title}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-sky-600 text-white text-[10px] font-bold">
              {badge}
            </span>
          )}
          {subtitle && (
            <span className="text-[11px] text-slate-400 truncate">{subtitle}</span>
          )}
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="max-h-[40vh] overflow-y-auto px-4 sm:px-6 pb-4 border-t border-slate-100">
          <div className="pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}
