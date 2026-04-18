import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  Layers,
  Users as UsersIcon,
} from 'lucide-react';
import type { IssueNode } from '../types';
import { formatHours } from '../lib/time';

interface Props {
  node: IssueNode;
  depth: number;
  rootBadge?: 'pm-root' | 'standalone' | null;
}

export function IssueNodeCard({ node, depth, rootBadge = null }: Props) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`group rounded-xl border transition ${
          node.isContextOnly
            ? 'bg-slate-50/60 border-slate-200'
            : 'bg-white border-slate-200 shadow-sm hover:shadow-md'
        }`}
      >
        <div className="p-4 flex items-start gap-3">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 h-7 w-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div className="mt-0.5 h-7 w-7 flex items-center justify-center text-slate-300">
              <GitBranch className="w-3.5 h-3.5" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <ProjectBadge name={node.issue.projectName} />
              <span className="text-xs font-mono text-slate-500">#{node.issue.iid}</span>
              {rootBadge === 'pm-root' && <Tag color="sky">PM root</Tag>}
              {rootBadge === 'standalone' && <Tag color="amber">Standalone</Tag>}
              {node.isShared && <Tag color="emerald">Shared</Tag>}
              {node.isContextOnly && <Tag color="slate">Context only</Tag>}
            </div>

            <a
              href={node.issue.webUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900 hover:text-sky-700 transition"
            >
              {node.issue.title}
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MetricCard
                label="Total (all time)"
                value={formatHours(node.totalSecondsAllTime)}
                accent={false}
              />
              <MetricCard
                label="In selected period"
                value={formatHours(node.totalSecondsInPeriod)}
                accent
              />
            </div>

            {node.users.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <UsersIcon className="w-3.5 h-3.5" />
                  Per-user breakdown
                </div>
                <ul className="space-y-1.5">
                  {node.users.map((u) => (
                    <li
                      key={u.userId}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={u.userName} url={u.userAvatarUrl} />
                        <span className="text-sm font-medium text-slate-800 truncate">
                          {u.userName}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5 text-sm whitespace-nowrap">
                        <span className="font-semibold text-sky-700">
                          {formatHours(u.secondsInPeriod)}
                        </span>
                        <span className="text-slate-400">of</span>
                        <span className="text-slate-600">
                          {formatHours(u.secondsAllTime)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="mt-3 ml-6 pl-4 border-l-2 border-slate-200 space-y-3">
          {node.children.map((child) => (
            <IssueNodeCard key={child.issue.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: boolean;
}) {
  return (
    <div
      className={`px-3 py-2.5 rounded-lg border ${
        accent
          ? 'bg-sky-50 border-sky-200 text-sky-900'
          : 'bg-slate-50 border-slate-200 text-slate-800'
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-70">
        {accent ? <Clock className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function ProjectBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium">
      <FolderIcon />
      {name}
    </span>
  );
}

function FolderIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3 h-3"
    >
      <path d="M4 4h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode;
  color: 'sky' | 'amber' | 'emerald' | 'slate';
}) {
  const map: Record<string, string> = {
    sky: 'bg-sky-100 text-sky-800 border-sky-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide border ${map[color]}`}
    >
      {children}
    </span>
  );
}

function Avatar({ name, url }: { name: string; url?: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (url) {
    return (
      <img src={url} alt={name} className="h-6 w-6 rounded-full object-cover" />
    );
  }
  return (
    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-sky-400 to-emerald-500 text-white text-[10px] font-semibold flex items-center justify-center">
      {initials}
    </div>
  );
}
