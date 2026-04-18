import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  FolderGit2,
  Inbox,
  Layers,
  ListTree,
  Sigma,
  SquareUser as UserSquare2,
  Users,
} from 'lucide-react';
import type { PmTree, ReportResult, TreeRollup } from '../types';
import { formatHours } from '../lib/time';
import { GanttView } from './GanttView';
import { IssueNodeCard } from './IssueNodeCard';
import { PeopleView } from './PeopleView';

interface Props {
  report: ReportResult;
  onReset: () => void;
}

type ViewMode = 'trees' | 'people' | 'gantt';

export function ReportView({ report, onReset }: Props) {
  const [mode, setMode] = useState<ViewMode>('trees');
  const isEmpty = report.pmTrees.length === 0 && report.standalone.length === 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Report result</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <FolderGit2 className="w-3.5 h-3.5" />
                  {report.projectPath}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" />
                  {report.period.start} - {report.period.end}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ViewSwitch mode={mode} onChange={setMode} />
            <button
              onClick={onReset}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              New report
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat
            icon={<Clock />}
            label="Hours in period"
            value={formatHours(report.totals.secondsInPeriod)}
            tone="sky"
          />
          <Stat
            icon={<Layers className="w-5 h-5" />}
            label="Issues with period time"
            value={String(report.totals.issuesInPeriod)}
            tone="emerald"
          />
          <Stat
            icon={<Users className="w-5 h-5" />}
            label="Contributors"
            value={String(report.totals.usersInPeriod)}
            tone="amber"
          />
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-950">Verification warnings</h3>
              <ul className="mt-2 space-y-1 text-sm text-amber-900">
                {report.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
            <Inbox className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">No matching data</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-md">
            No time entries were tracked in the selected period, and no linked PM clusters contain
            activity. Try adjusting the date range or the main project.
          </p>
        </div>
      )}

      {!isEmpty && mode === 'trees' && (
        <>
          <GrandTotalBanner report={report} />

          {report.pmTrees.length > 0 && (
            <section>
              <SectionHeader
                title="PM clusters"
                count={report.pmTrees.length}
                description="Linked PM issues are merged into one cluster. Shared branches are deduplicated in totals but stay visible under the PM issue they are linked from."
              />
              <div className="space-y-6">
                {report.pmTrees.map((tree) => (
                  <TreeBlock
                    key={tree.treeId}
                    tree={tree}
                    rollup={report.treeRollups[tree.treeId]}
                  />
                ))}
              </div>
            </section>
          )}

          {report.standalone.length > 0 && (
            <section>
              <SectionHeader
                title="Standalone work items"
                count={report.standalone.length}
                description="Work items with tracked time in the selected period that are not linked to any PM cluster."
              />
              <div className="space-y-4">
                {report.standalone.map((node) => (
                  <IssueNodeCard
                    key={node.issue.id}
                    node={node}
                    depth={0}
                    rootBadge="standalone"
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {!isEmpty && mode === 'people' && (
        <PeopleView
          people={report.people}
          grandTotalSecondsInPeriod={report.grandTotal.secondsInPeriod}
        />
      )}

      {!isEmpty && mode === 'gantt' && <GanttView report={report} />}
    </div>
  );
}

function ViewSwitch({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
      <button
        onClick={() => onChange('trees')}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
          mode === 'trees'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-800'
        }`}
      >
        <ListTree className="w-3.5 h-3.5" />
        Trees
      </button>
      <button
        onClick={() => onChange('people')}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
          mode === 'people'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-800'
        }`}
      >
        <UserSquare2 className="w-3.5 h-3.5" />
        People
      </button>
      <button
        onClick={() => onChange('gantt')}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
          mode === 'gantt'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-800'
        }`}
      >
        <CalendarRange className="w-3.5 h-3.5" />
        Gantt
      </button>
    </div>
  );
}

function GrandTotalBanner({ report }: { report: ReportResult }) {
  const { grandTotal } = report;
  const topUsers = grandTotal.users.filter((user) => user.secondsInPeriod > 0).slice(0, 6);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-900/10 bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 text-white p-6 shadow-md">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
            <Sigma className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-sky-200/80 font-semibold">
              Grand total
            </div>
            <div className="text-sm text-slate-200">
              Aggregated across all PM clusters and standalone items
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-sky-200/80">In period</div>
            <div className="text-3xl font-bold tabular-nums">
              {formatHours(grandTotal.secondsInPeriod)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-sky-200/80">All time</div>
            <div className="text-3xl font-bold tabular-nums text-slate-300">
              {formatHours(grandTotal.secondsAllTime)}
            </div>
          </div>
        </div>
      </div>

      {topUsers.length > 0 && (
        <div className="mt-5 pt-5 border-t border-white/10">
          <div className="text-[11px] uppercase tracking-wider text-sky-200/80 mb-2 font-semibold">
            Top contributors
          </div>
          <ul className="flex flex-wrap gap-2">
            {topUsers.map((user) => (
              <li
                key={user.userId}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/10 text-xs"
              >
                <span className="font-medium">{user.userName}</span>
                <span className="font-bold tabular-nums text-sky-100">
                  {formatHours(user.secondsInPeriod)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TreeBlock({ tree, rollup }: { tree: PmTree; rollup?: TreeRollup }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/40 shadow-sm overflow-hidden">
      {rollup && <TreeRollupBanner rollup={rollup} tree={tree} />}
      <div className="p-4 space-y-4">
        {tree.pmIssues.map((node) => (
          <IssueNodeCard key={node.issue.id} node={node} depth={0} rootBadge="pm-root" />
        ))}
      </div>
    </div>
  );
}

function TreeRollupBanner({ rollup, tree }: { rollup: TreeRollup; tree: PmTree }) {
  const rootLabels = tree.pmIssues.map((node) => `#${node.issue.iid}`).join(', ');
  const summary =
    tree.pmIssues.length === 1
      ? `PM root ${rootLabels}`
      : `${tree.pmIssues.length} linked PM roots: ${rootLabels}`;

  return (
    <div className="border-b border-sky-200 bg-gradient-to-br from-sky-50 to-emerald-50 px-4 py-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-sky-800/80 font-bold">
            Cluster total
          </div>
          <div className="text-xs text-slate-700 truncate">
            {summary} - {rollup.issuesCount} unique issue(s)
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">In period</div>
            <div className="text-xl font-bold tabular-nums text-sky-800">
              {formatHours(rollup.secondsInPeriod)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">All time</div>
            <div className="text-xl font-bold tabular-nums text-slate-700">
              {formatHours(rollup.secondsAllTime)}
            </div>
          </div>
        </div>
      </div>

      {rollup.users.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rollup.users
            .filter((user) => user.secondsInPeriod > 0)
            .slice(0, 8)
            .map((user) => (
              <span
                key={user.userId}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/70 border border-sky-100 text-[11px]"
              >
                <span className="font-medium text-slate-700">{user.userName}</span>
                <span className="font-bold text-sky-700 tabular-nums">
                  {formatHours(user.secondsInPeriod)}
                </span>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function Clock() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'sky' | 'emerald' | 'amber';
}) {
  const toneMap: Record<string, string> = {
    sky: 'from-sky-50 to-sky-100 text-sky-900 border-sky-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    amber: 'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
  };
  const iconBg: Record<string, string> = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-gradient-to-br ${toneMap[tone]} p-4`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</div>
          <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
        </div>
        <div
          className={`h-9 w-9 rounded-lg ${iconBg[tone]} text-white flex items-center justify-center`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  description,
}: {
  title: string;
  count: number;
  description: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
        <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-slate-900 text-white text-[10px] font-bold">
          {count}
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-0.5">{description}</p>
    </div>
  );
}
