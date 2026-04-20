import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FolderKanban,
  Shapes,
  SquareUser,
  Users,
} from 'lucide-react';
import type { ReportResult } from '../types';
import {
  PROJECT_ROLE_OPTIONS,
  buildPlanningAssignedPeople,
  buildPlanningBoards,
  buildPlanningRoleCounts,
  buildPlanningTaskRows,
  getAssignedBoardRole,
  getPlanningBoardMappedSeconds,
  getPlanningMappedSeconds,
  getProjectRoleLabel,
  type PlanningAssignments,
  type PlanningBoard,
  type ProjectRole,
} from '../lib/planning';
import { downloadPlanningWorkbook } from '../lib/planningExport';
import { formatHours } from '../lib/time';

interface Props {
  report: ReportResult;
  assignments: PlanningAssignments;
  onAssignmentsChange: (assignments: PlanningAssignments) => void;
  onBack: () => void;
}

export function PlanningBuilderView({
  report,
  assignments,
  onAssignmentsChange,
  onBack,
}: Props) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boards = useMemo(() => buildPlanningBoards(report), [report]);
  const exportPeople = useMemo(
    () => buildPlanningAssignedPeople(boards, assignments),
    [assignments, boards]
  );
  const roleCounts = useMemo(
    () => buildPlanningRoleCounts(boards, assignments),
    [assignments, boards]
  );
  const planningRows = useMemo(
    () => buildPlanningTaskRows(report, assignments),
    [assignments, report]
  );
  const uniqueContributorCount = useMemo(
    () => new Set(boards.flatMap((board) => board.contributors.map((contributor) => contributor.userId)))
      .size,
    [boards]
  );
  const mappedSeconds = useMemo(
    () => getPlanningMappedSeconds(boards, assignments),
    [assignments, boards]
  );
  const unmappedSeconds = Math.max(0, report.grandTotal.secondsInPeriod - mappedSeconds);
  const topLevelRows = planningRows.filter((row) => row.depth === 0).length;
  const assignedBoardRoleSlots = Object.values(roleCounts).reduce((total, count) => total + count, 0);

  const handleRoleChange = (boardId: string, userId: string, nextRole: ProjectRole | null) => {
    setError(null);
    onAssignmentsChange({
      ...assignments,
      [boardId]: {
        ...(assignments[boardId] || {}),
        [userId]: nextRole,
      },
    });
  };

  const handleDownload = async () => {
    setError(null);
    setExporting(true);

    try {
      await downloadPlanningWorkbook(report, assignments);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'Failed to build planning workbook'
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-600 to-sky-700 text-white flex items-center justify-center shadow-sm shrink-0">
              <Shapes className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Build planning</h2>
              <p className="mt-1 text-sm text-slate-600 max-w-3xl">
                Roles are now assigned per GitLab project path. The same person can be
                `Backend developer` on `project/project-backend` and `Lead` on
                `project/project-pm`, while the export still sums all hours from every board into
                one workbook.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>{report.projectPath}</span>
                <span>
                  {report.period.start} - {report.period.end}
                </span>
                <span>{planningRows.length} task row(s) ready for export</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to report
            </button>
            <button
              onClick={handleDownload}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Preparing workbook...' : 'Download planning'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          icon={<FolderKanban className="w-5 h-5" />}
          title="Boards in scope"
          value={String(boards.length)}
          tone="sky"
        />
        <StatCard
          icon={<Users className="w-5 h-5" />}
          title="Unique contributors"
          value={String(uniqueContributorCount)}
          tone="emerald"
        />
        <StatCard
          icon={<SquareUser className="w-5 h-5" />}
          title="Assigned board roles"
          value={String(assignedBoardRoleSlots)}
          tone="amber"
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          title="Unmapped period hours"
          value={formatHours(unmappedSeconds)}
          tone={unmappedSeconds > 0 ? 'rose' : 'emerald'}
        />
      </div>

      {(unmappedSeconds > 0 || error) && (
        <div
          className={`rounded-2xl px-5 py-4 border ${
            error ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                error ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              {error ? (
                <>
                  <h3 className="text-sm font-semibold text-rose-950">Export failed</h3>
                  <p className="mt-1 text-sm text-rose-900">{error}</p>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-amber-950">
                    Some board hours are still outside the export
                  </h3>
                  <p className="mt-1 text-sm text-amber-900">
                    {formatHours(unmappedSeconds)} from the selected period belong to board/user
                    combinations without an assigned role yet. The workbook can still be downloaded,
                    but those cells will stay empty until you assign roles on the missing boards.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)] gap-6">
        <section className="space-y-4">
          {boards.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-sm text-slate-500">
              No boards were found in this report.
            </div>
          ) : (
            boards.map((board) => (
              <BoardAssignmentCard
                key={board.boardId}
                board={board}
                assignments={assignments}
                onRoleChange={handleRoleChange}
              />
            ))
          )}
        </section>

        <div className="space-y-6">
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900">Hours by boards</h3>
            <p className="mt-1 text-xs text-slate-500">
              Each board sums unique issues only once, so shared branches inside one PM cluster do
              not inflate totals.
            </p>

            <ul className="mt-4 space-y-2">
              {boards.map((board) => {
                const mappedBoardSeconds = getPlanningBoardMappedSeconds(board, assignments);
                const unmappedBoardSeconds = Math.max(0, board.secondsInPeriod - mappedBoardSeconds);

                return (
                  <li
                    key={board.boardId}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {board.projectPath}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {board.projectName}
                          <span className="mx-1.5 text-slate-300">|</span>
                          {board.issuesCount} unique issue(s)
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-slate-900 tabular-nums">
                          {formatHours(board.secondsInPeriod)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {board.contributors.length} contributor(s)
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      Mapped: {formatHours(mappedBoardSeconds)}
                      <span className="mx-1.5 text-slate-300">|</span>
                      Unmapped: {formatHours(unmappedBoardSeconds)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900">Role coverage by boards</h3>
            <p className="mt-1 text-xs text-slate-500">
              The Excel template keeps one shared estimate column for `PM, Analytic`, so these two
              roles are summed there during export.
            </p>

            <ul className="mt-4 space-y-2">
              {PROJECT_ROLE_OPTIONS.map((role) => (
                <li
                  key={role.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
                >
                  <span className="text-sm font-medium text-slate-700">{role.label}</span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums">
                    {roleCounts[role.id]}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Employee export preview</h3>
              <p className="mt-1 text-xs text-slate-500">
                One person may appear multiple times here if they have different roles on different
                boards.
              </p>
            </div>

            {exportPeople.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">
                No board roles assigned yet, so the employee section of the workbook is still empty.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {exportPeople.map((row) => (
                  <div key={`${row.userId}-${row.role}`} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {row.userName}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {getProjectRoleLabel(row.role)}
                          <span className="mx-1.5 text-slate-300">|</span>
                          {row.boardIds.length} board(s)
                        </div>
                      </div>
                      <div className="text-sm font-bold text-sky-700 tabular-nums shrink-0">
                        {formatHours(row.secondsInPeriod)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Planning tree preview</h3>
              <p className="mt-1 text-xs text-slate-500">
                The task order below is the exact order that will be written into the workbook.
              </p>
            </div>

            {planningRows.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No tasks available for planning export.</div>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <div className="px-5 py-3 text-[11px] text-slate-500 border-b border-slate-100">
                  {planningRows.length} row(s) total, {topLevelRows} top-level board item(s)
                </div>
                <div className="divide-y divide-slate-100">
                  {planningRows.map((row, index) => {
                    return (
                      <div key={`${row.boardId}-${row.issueId}-${index}`}>
                        <div
                          className="px-5 py-3 flex items-start gap-3"
                          style={{ paddingLeft: `${20 + row.depth * 22}px` }}
                        >
                          <div className="mt-0.5 w-5 shrink-0 text-xs font-bold text-slate-400 tabular-nums">
                            {row.rowMarker}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm text-slate-800 break-words">{row.title}</div>
                            <div className="mt-1 text-[11px] text-slate-400">
                              #{row.issueIid}
                              <span className="mx-1.5 text-slate-300">|</span>
                              {row.boardTitle}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function BoardAssignmentCard({
  board,
  assignments,
  onRoleChange,
}: {
  board: PlanningBoard;
  assignments: PlanningAssignments;
  onRoleChange: (boardId: string, userId: string, nextRole: ProjectRole | null) => void;
}) {
  const mappedSeconds = getPlanningBoardMappedSeconds(board, assignments);
  const unmappedSeconds = Math.max(0, board.secondsInPeriod - mappedSeconds);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{board.projectPath}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {board.projectName}
              <span className="mx-1.5 text-slate-300">|</span>
              {board.issuesCount} unique issue(s) with hours in scope
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <BoardBadge label="Total" value={formatHours(board.secondsInPeriod)} tone="sky" />
            <BoardBadge label="Mapped" value={formatHours(mappedSeconds)} tone="emerald" />
            <BoardBadge label="Unmapped" value={formatHours(unmappedSeconds)} tone="amber" />
            <BoardBadge
              label="People"
              value={String(board.contributors.length)}
              tone="slate"
            />
          </div>
        </div>
      </div>

      {board.contributors.length === 0 ? (
        <div className="p-8 text-sm text-slate-500">No contributors with hours on this board.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {board.contributors.map((contributor) => (
            <div
              key={`${board.boardId}-${contributor.userId}`}
              className="px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Avatar name={contributor.userName} url={contributor.userAvatarUrl} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {contributor.userName}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatHours(contributor.secondsInPeriod)} on this board
                    <span className="text-slate-300 mx-1.5">|</span>
                    {contributor.issuesTouchedInPeriod} issue(s)
                  </div>
                </div>
              </div>

              <div className="lg:w-64">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Role on this board
                </label>
                <select
                  value={getAssignedBoardRole(assignments, board.boardId, contributor.userId) ?? ''}
                  onChange={(event) =>
                    onRoleChange(
                      board.boardId,
                      contributor.userId,
                      event.target.value ? (event.target.value as ProjectRole) : null
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-200"
                >
                  <option value="">Not assigned</option>
                  {PROJECT_ROLE_OPTIONS.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BoardBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'sky' | 'emerald' | 'amber' | 'slate';
}) {
  const toneClasses: Record<'sky' | 'emerald' | 'amber' | 'slate', string> = {
    sky: 'bg-sky-100 text-sky-800 border-sky-200',
    emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${toneClasses[tone]}`}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function StatCard({
  icon,
  title,
  value,
  tone,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  tone: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  const toneMap: Record<'sky' | 'emerald' | 'amber' | 'rose', string> = {
    sky: 'from-sky-50 to-sky-100 text-sky-900 border-sky-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    amber: 'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
    rose: 'from-rose-50 to-rose-100 text-rose-900 border-rose-200',
  };

  const iconTone: Record<'sky' | 'emerald' | 'amber' | 'rose', string> = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };

  return (
    <div className={`rounded-xl border bg-gradient-to-br ${toneMap[tone]} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">{title}</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
        </div>
        <div
          className={`h-9 w-9 rounded-lg ${iconTone[tone]} text-white flex items-center justify-center shrink-0`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, url }: { name: string; url?: string }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (url) {
    return <img src={url} alt={name} className="h-10 w-10 rounded-full object-cover shrink-0" />;
  }

  return (
    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-sky-400 to-emerald-500 text-white text-sm font-semibold flex items-center justify-center shrink-0">
      {initials}
    </div>
  );
}
