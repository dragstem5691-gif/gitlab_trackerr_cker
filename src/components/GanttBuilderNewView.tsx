import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  GitBranch,
  GripHorizontal,
  RefreshCw,
  Save,
  Table2,
  Upload,
  Users,
} from 'lucide-react';
import type { ReportResult } from '../types';
import {
  buildCapacityWeekLoads,
  buildGanttBuilderCalendarDates,
  createTaskAssignment,
  createGitLabGanttBuilderPlan,
  getAssignmentPersonHours,
  getAssignmentPersonStartDate,
  getDailyCapacityHours,
  getRoleLabel,
  getTaskEndDate,
  getTaskScheduleEntries,
  getTaskTotalEstimateHours,
  isPlanWorkingDay,
  isWorkingDay,
  nextWorkingDate,
  normalizeEstimateHours,
  type GanttBuilderPerson,
  type GanttBuilderTask,
  type GanttBuilderTaskAssignment,
} from '../lib/ganttBuilder';
import {
  GitLabClient,
  type GitLabGanttIssue,
  type GitLabGanttIssueStrategy,
  type GitLabGanttMilestone,
} from '../lib/gitlab';
import {
  buildGanttBuilderNewConflicts,
  createGanttBuilderNewContext,
  createGanttBuilderNewDocument,
  getGanttBuilderNewStorageKey,
  getOldGanttBuilderPlanInfo,
  importOldGanttBuilderPlan,
  loadGanttBuilderNewDocument,
  saveGanttBuilderNewDocument,
  type GanttBuilderNewDocument,
  type GanttBuilderNewZoom,
} from '../lib/ganttBuilderNew';
import { PROJECT_ROLE_OPTIONS, type ProjectRole } from '../lib/planning';

interface Props {
  report?: ReportResult | null;
  gitLabConfig?: GanttGitLabConfig | null;
  onBack: () => void;
  onOpenClassic: () => void;
}

interface GanttGitLabConfig {
  instanceOrigin: string;
  token: string;
  mainScopePath: string;
  pmProjectPath: string;
}

interface TimelineColumn {
  id: string;
  label: string;
  subLabel: string;
  dates: string[];
  width: number;
}

interface DatePosition {
  left: number;
  width: number;
}

type TimelineInteractionMode = 'move' | 'resize';

interface TimelineDragState {
  taskId: string;
  mode: TimelineInteractionMode;
  originClientX: number;
  originStartDate: string;
  originEstimateHours: number;
  dailyCapacityHours: number;
}

const TASK_GRID_WIDTH = 820;
const TASK_GRID_TEMPLATE = 'minmax(190px,1fr) 116px 76px 130px 118px 76px';
const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 42;
const MIN_TASK_ESTIMATE_HOURS = 0.25;

export function GanttBuilderNewView({ report, gitLabConfig, onBack, onOpenClassic }: Props) {
  const baseContext = useMemo(() => createGanttBuilderNewContext(report), [report]);
  const [gitLabPeriod, setGitLabPeriod] = useState(baseContext.period);
  const context = useMemo(
    () =>
      gitLabConfig
        ? {
            ...baseContext,
            projectPath: gitLabConfig.mainScopePath,
            period: gitLabPeriod,
            source: 'report' as const,
          }
        : baseContext,
    [baseContext, gitLabConfig, gitLabPeriod]
  );
  const storageKey = useMemo(() => getGanttBuilderNewStorageKey(context), [context]);
  const [document, setDocument] = useState<GanttBuilderNewDocument | null>(() =>
    loadGanttBuilderNewDocument(context)
  );
  const [savedPlanJson, setSavedPlanJson] = useState(() => JSON.stringify(document));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gitLabMilestones, setGitLabMilestones] = useState<GitLabGanttMilestone[]>([]);
  const [gitLabIssueCount, setGitLabIssueCount] = useState(0);
  const [taskSelectionStrategy, setTaskSelectionStrategy] =
    useState<GitLabGanttIssueStrategy>('milestone');
  const [selectedMilestoneTitle, setSelectedMilestoneTitle] = useState('');
  const [activeWindowDays, setActiveWindowDays] = useState(45);
  const [gitLabLoading, setGitLabLoading] = useState(false);
  const [gitLabError, setGitLabError] = useState<string | null>(null);
  const [gitLabNotice, setGitLabNotice] = useState<string | null>(null);
  const [dragState, setDragState] = useState<TimelineDragState | null>(null);

  useEffect(() => {
    setGitLabPeriod(baseContext.period);
  }, [baseContext.period]);

  useEffect(() => {
    const nextDocument = loadGanttBuilderNewDocument(context);
    setDocument(nextDocument);
    setSavedPlanJson(JSON.stringify(nextDocument));
    setSelectedTaskId(null);
  }, [context, storageKey]);

  const hasUnsavedChanges = JSON.stringify(document) !== savedPlanJson;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  const oldPlanInfo = useMemo(() => getOldGanttBuilderPlanInfo(context), [context]);
  const plan = document?.plan ?? null;
  const peopleById = useMemo(
    () => new Map((plan?.people ?? []).map((person) => [person.id, person])),
    [plan?.people]
  );
  const dates = useMemo(
    () => (plan ? buildGanttBuilderCalendarDates(plan, context) : []),
    [context, plan]
  );
  const timeline = useMemo(
    () =>
      buildTimelineModel(
        dates,
        document?.view.zoom ?? 'week',
        document?.view.showWeekends ?? true
      ),
    [dates, document?.view.showWeekends, document?.view.zoom]
  );
  const conflicts = useMemo(
    () => (document ? buildGanttBuilderNewConflicts(document, context) : []),
    [context, document]
  );
  const loadsByPersonId = useMemo(() => (plan ? buildCapacityWeekLoads(plan) : {}), [plan]);
  const tasks = plan?.tasks ?? [];
  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) ?? null
    : null;

  const updateDocument = useCallback(
    (updater: (current: GanttBuilderNewDocument) => GanttBuilderNewDocument) => {
      setDocument((current) => {
        if (!current) return current;
        return {
          ...updater(current),
          updatedAt: new Date().toISOString(),
        };
      });
    },
    []
  );

  useEffect(() => {
    if (!dragState) return;

    const previousCursor = window.document.body.style.cursor;
    const previousUserSelect = window.document.body.style.userSelect;
    window.document.body.style.cursor = dragState.mode === 'resize' ? 'ew-resize' : 'grabbing';
    window.document.body.style.userSelect = 'none';

    const onPointerMove = (event: PointerEvent) => {
      const dayDelta = Math.round(
        (event.clientX - dragState.originClientX) / Math.max(1, timeline.dragStepWidth)
      );

      updateDocument((current) => {
        const plan =
          dragState.mode === 'resize'
            ? resizeTaskPrimaryEstimate(
                current.plan,
                dragState.taskId,
                Math.max(
                  MIN_TASK_ESTIMATE_HOURS,
                  dragState.originEstimateHours + dayDelta * dragState.dailyCapacityHours
                )
              )
            : moveTaskSchedule(
                current.plan,
                dragState.taskId,
                resolvePlanWorkingDate(
                  addDays(dragState.originStartDate, dayDelta),
                  current.plan.nonWorkingDates,
                  dayDelta
                )
              );

        return {
          ...current,
          plan,
        };
      });
    };

    const stopDragging = () => setDragState(null);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging, { once: true });
    window.addEventListener('pointercancel', stopDragging, { once: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      window.document.body.style.cursor = previousCursor;
      window.document.body.style.userSelect = previousUserSelect;
    };
  }, [dragState, timeline.dragStepWidth, updateDocument]);

  const handleTaskTitleChange = (taskId: string, title: string) => {
    updateDocument((current) => ({
      ...current,
      plan: updatePlanTask(current.plan, taskId, { title }),
    }));
  };

  const handlePrimaryStartChange = (taskId: string, startDate: string) => {
    if (!isIsoDate(startDate)) return;
    updateDocument((current) => ({
      ...current,
      plan: moveTaskSchedule(current.plan, taskId, startDate),
    }));
  };

  const handlePrimaryEstimateChange = (taskId: string, estimateHours: number) => {
    if (!Number.isFinite(estimateHours) || estimateHours <= 0) return;
    updateDocument((current) => ({
      ...current,
      plan: resizeTaskPrimaryEstimate(current.plan, taskId, estimateHours),
    }));
  };

  const handlePrimaryAssigneeChange = (taskId: string, assigneeId: string) => {
    updateDocument((current) => {
      const person = current.plan.people.find((candidate) => candidate.id === assigneeId);
      return {
        ...current,
        plan: updateTaskPrimaryAssignment(current.plan, taskId, {
          assigneeIds: assigneeId ? [assigneeId] : [],
          role: person?.role,
        }),
      };
    });
  };

  const handlePrimaryRoleChange = (taskId: string, role: ProjectRole | '') => {
    updateDocument((current) => ({
      ...current,
      plan: updateTaskPrimaryAssignment(current.plan, taskId, {
        role: role || null,
      }),
    }));
  };

  const handleTaskPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    task: GanttBuilderTask,
    mode: TimelineInteractionMode
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedTaskId(task.id);

    const primaryAssignment = getPrimaryAssignment(task);
    const primaryPersonId = primaryAssignment?.assigneeIds[0] ?? null;
    const primaryPerson = primaryPersonId ? peopleById.get(primaryPersonId) : undefined;

    setDragState({
      taskId: task.id,
      mode,
      originClientX: event.clientX,
      originStartDate: getTaskEarliestStartDate(task),
      originEstimateHours: primaryAssignment?.estimateHours ?? getTaskTotalEstimateHours(task),
      dailyCapacityHours: getDailyCapacityHours(primaryPerson),
    });
  };

  const confirmLeave = () => {
    if (!hasUnsavedChanges) return true;
    return window.confirm('Leave Gantt Builder New with unsaved local changes?');
  };

  const handleCreateManualPlan = () => {
    const nextDocument = createGanttBuilderNewDocument(context);
    setDocument(nextDocument);
    setSavedPlanJson(JSON.stringify(null));
    setNotice('Created an unsaved beta plan.');
  };

  const handleImportOldPlan = () => {
    if (!oldPlanInfo.exists) {
      setNotice('No saved classic Gantt plan exists for this project and period.');
      return;
    }
    const nextDocument = importOldGanttBuilderPlan(context);
    setDocument(nextDocument);
    setSavedPlanJson(JSON.stringify(null));
    setNotice('Imported a separate beta copy of the classic Gantt plan.');
  };

  const handleSave = () => {
    if (!document) return;
    const saved = saveGanttBuilderNewDocument(context, document);
    setDocument(saved);
    setSavedPlanJson(JSON.stringify(saved));
    setNotice('Saved beta plan locally.');
  };

  const loadGitLabPlan = async (
    options: {
      milestoneTitle?: string;
      strategy?: GitLabGanttIssueStrategy;
      windowDays?: number;
    } = {}
  ) => {
    if (!gitLabConfig) {
      setGitLabError('GitLab connection is not configured.');
      return;
    }

    const milestoneTitle = options.milestoneTitle ?? selectedMilestoneTitle;
    const strategy = options.strategy ?? taskSelectionStrategy;
    const windowDays = options.windowDays ?? activeWindowDays;
    const updatedAfter = getUpdatedAfterIso(windowDays);

    setGitLabLoading(true);
    setGitLabError(null);
    setGitLabNotice(null);
    setNotice(null);

    try {
      const client = new GitLabClient(gitLabConfig.instanceOrigin, gitLabConfig.token);
      const [mainMilestones, pmMilestones] = await Promise.all([
        client.fetchGanttMilestones(gitLabConfig.mainScopePath),
        client.fetchGanttMilestones(gitLabConfig.pmProjectPath),
      ]);
      const milestones = dedupeMilestones([...mainMilestones, ...pmMilestones]);
      setGitLabMilestones(milestones);

      if (strategy === 'milestone' && !milestoneTitle) {
        setGitLabNotice('Choose a milestone, then load GitLab tasks into beta.');
        setGitLabIssueCount(0);
        return;
      }

      const [mainIssues, pmIssues] = await Promise.all([
        client.fetchGanttIssuesFromScope(gitLabConfig.mainScopePath, {
          strategy,
          milestoneTitle: strategy === 'milestone' ? milestoneTitle : null,
          updatedAfter,
        }),
        client.fetchGanttIssuesFromProject(gitLabConfig.pmProjectPath, {
          strategy,
          milestoneTitle: strategy === 'milestone' ? milestoneTitle : null,
          updatedAfter,
        }),
      ]);
      const issues = dedupeGitLabIssues([...mainIssues, ...pmIssues]);
      const selectedMilestone = milestones.find((milestone) => milestone.title === milestoneTitle);
      const milestonePeriod =
        selectedMilestone?.startDate && selectedMilestone?.dueDate
          ? { start: selectedMilestone.startDate, end: selectedMilestone.dueDate }
          : null;
      let nextPeriod = milestonePeriod ?? baseContext.period;

      if (strategy === 'milestone' && milestonePeriod) {
        const currentPeriod = gitLabPeriod;
        const matches =
          currentPeriod.start === milestonePeriod.start &&
          currentPeriod.end === milestonePeriod.end;
        if (!matches) {
          const useGitLab = window.confirm(
            [
              'The selected beta Gantt range does not match this GitLab milestone.',
              '',
              `Current range: ${currentPeriod.start} - ${currentPeriod.end}`,
              `GitLab milestone "${milestoneTitle}": ${milestonePeriod.start} - ${milestonePeriod.end}`,
              '',
              'OK = use GitLab milestone dates.',
              'Cancel = keep current range.',
            ].join('\n')
          );
          nextPeriod = useGitLab ? milestonePeriod : currentPeriod;
        }
      }

      const nextContext = {
        ...baseContext,
        projectPath: gitLabConfig.mainScopePath,
        period: nextPeriod,
        source: 'report' as const,
      };
      const previousBetaDocument = loadGanttBuilderNewDocument(nextContext);
      const nextPlan = createGitLabGanttBuilderPlan(
        nextContext,
        issues,
        previousBetaDocument?.plan ?? document?.plan
      );
      const nextDocument: GanttBuilderNewDocument = {
        ...createGanttBuilderNewDocument(nextContext, {
          source: 'gitlab-import',
          plan: nextPlan,
        }),
        view: document?.view ?? previousBetaDocument?.view ?? {
          zoom: 'week',
          panel: 'workload',
          showWeekends: true,
        },
      };
      const savedDocument = saveGanttBuilderNewDocument(nextContext, nextDocument);

      setGitLabIssueCount(issues.length);
      setGitLabPeriod(nextPeriod);
      setDocument(savedDocument);
      setSavedPlanJson(JSON.stringify(savedDocument));
      setSelectedTaskId(null);
      setNotice(`Loaded ${issues.length} GitLab task(s) into a saved beta plan.`);
    } catch (error) {
      setGitLabError(error instanceof Error ? error.message : 'Failed to load GitLab beta data');
    } finally {
      setGitLabLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">Gantt Builder New</h2>
                <span className="rounded bg-sky-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-100">
                  Beta
                </span>
                <span className="rounded border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] text-slate-200">
                  {document?.source ?? 'not started'}
                </span>
                <span className="rounded border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] text-slate-200">
                  {hasUnsavedChanges ? 'Unsaved changes' : document ? 'Saved locally' : 'No beta plan'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
                <span>{context.projectPath}</span>
                <span>{context.period.start} - {context.period.end}</span>
                <span>{storageKey}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCreateManualPlan}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
              >
                <Table2 className="h-3.5 w-3.5" />
                Manual beta plan
              </button>
              <button
                type="button"
                onClick={handleImportOldPlan}
                disabled={!oldPlanInfo.exists}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45"
                title={
                  oldPlanInfo.exists
                    ? 'Copy classic Gantt plan into beta storage'
                    : 'No saved classic Gantt plan for this project and period'
                }
              >
                <Upload className="h-3.5 w-3.5" />
                Import classic plan
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!document || !hasUnsavedChanges}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                Save beta
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmLeave()) onOpenClassic();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
              >
                Classic builder
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmLeave()) onBack();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <ViewButton
              active={document?.view.zoom === 'day'}
              label="Day"
              onClick={() => updateDocument((current) => setZoom(current, 'day'))}
              disabled={!document}
            />
            <ViewButton
              active={!document || document.view.zoom === 'week'}
              label="Week"
              onClick={() => updateDocument((current) => setZoom(current, 'week'))}
              disabled={!document}
            />
            <ViewButton
              active={document?.view.zoom === 'month'}
              label="Month"
              onClick={() => updateDocument((current) => setZoom(current, 'month'))}
              disabled={!document}
            />
            <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={document?.view.showWeekends ?? true}
                disabled={!document}
                onChange={(event) =>
                  updateDocument((current) => ({
                    ...current,
                    view: {
                      ...current.view,
                      showWeekends: event.target.checked,
                    },
                  }))
                }
                className="h-3.5 w-3.5 rounded border-slate-300 text-sky-700 focus:ring-sky-200"
              />
              Weekends
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{tasks.length} task(s)</span>
            <span>{plan?.people.length ?? 0} people</span>
            <span>{conflicts.length} conflict(s)</span>
          </div>
        </div>

        {notice && (
          <div className="border-b border-sky-100 bg-sky-50 px-4 py-2 text-xs font-medium text-sky-800">
            {notice}
          </div>
        )}

        {gitLabConfig && (
          <GitLabSourcePanel
            activeWindowDays={activeWindowDays}
            gitLabConfig={gitLabConfig}
            gitLabError={gitLabError}
            gitLabIssueCount={gitLabIssueCount}
            gitLabLoading={gitLabLoading}
            gitLabMilestones={gitLabMilestones}
            gitLabNotice={gitLabNotice}
            selectedMilestoneTitle={selectedMilestoneTitle}
            strategy={taskSelectionStrategy}
            onActiveWindowDaysChange={(days) => {
              setActiveWindowDays(days);
              if (taskSelectionStrategy === 'active') {
                void loadGitLabPlan({ strategy: 'active', windowDays: days });
              }
            }}
            onLoad={() => void loadGitLabPlan()}
            onMilestoneChange={(title) => {
              setSelectedMilestoneTitle(title);
              if (title) void loadGitLabPlan({ milestoneTitle: title });
            }}
            onStrategyChange={(strategy) => {
              setTaskSelectionStrategy(strategy);
              if (strategy === 'active') {
                void loadGitLabPlan({ strategy });
              }
            }}
          />
        )}

        {!document ? (
          <BetaEmptyState
            oldPlanExists={oldPlanInfo.exists}
            gitLabEnabled={Boolean(gitLabConfig)}
            gitLabLoading={gitLabLoading}
            onCreateManualPlan={handleCreateManualPlan}
            onImportOldPlan={handleImportOldPlan}
            onLoadGitLab={() => void loadGitLabPlan()}
          />
        ) : (
          <>
            <BetaWorkspace
              document={document}
              peopleById={peopleById}
              selectedTaskId={selectedTaskId}
              timeline={timeline}
              onPrimaryAssigneeChange={handlePrimaryAssigneeChange}
              onPrimaryEstimateChange={handlePrimaryEstimateChange}
              onPrimaryRoleChange={handlePrimaryRoleChange}
              onPrimaryStartChange={handlePrimaryStartChange}
              onSelectTask={setSelectedTaskId}
              onTaskPointerDown={handleTaskPointerDown}
              onTaskTitleChange={handleTaskTitleChange}
            />
            <div className="grid grid-cols-1 border-t border-slate-200 lg:grid-cols-[minmax(0,1fr)_360px]">
              <WorkloadPanel
                people={document.plan.people}
                loadsByPersonId={loadsByPersonId}
                selectedPanel={document.view.panel}
                onSelectPanel={(panel) =>
                  updateDocument((current) => ({
                    ...current,
                    view: {
                      ...current.view,
                      panel,
                    },
                  }))
                }
              />
              <ConflictPanel
                conflicts={conflicts}
                selectedPanel={document.view.panel}
                onSelectPanel={(panel) =>
                  updateDocument((current) => ({
                    ...current,
                    view: {
                      ...current.view,
                      panel,
                    },
                  }))
                }
                onSelectTask={setSelectedTaskId}
              />
            </div>
          </>
        )}
      </section>

      {selectedTask && (
        <TaskInspector
          task={selectedTask}
          peopleById={peopleById}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}

function BetaEmptyState({
  oldPlanExists,
  gitLabEnabled,
  gitLabLoading,
  onCreateManualPlan,
  onImportOldPlan,
  onLoadGitLab,
}: {
  oldPlanExists: boolean;
  gitLabEnabled: boolean;
  gitLabLoading: boolean;
  onCreateManualPlan: () => void;
  onImportOldPlan: () => void;
  onLoadGitLab: () => void;
}) {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <CalendarRange className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Start a beta planning session</h3>
            <p className="mt-1 text-sm text-slate-500">
              Create a separate beta plan or copy the classic Gantt plan into isolated beta storage.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onCreateManualPlan}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Table2 className="h-4 w-4" />
            Create manual plan
          </button>
          <button
            type="button"
            onClick={onImportOldPlan}
            disabled={!oldPlanExists}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Import classic plan
          </button>
          <button
            type="button"
            onClick={onLoadGitLab}
            disabled={!gitLabEnabled || gitLabLoading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitBranch className="h-4 w-4" />
            {gitLabLoading ? 'Loading...' : 'Load GitLab'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GitLabSourcePanel({
  activeWindowDays,
  gitLabConfig,
  gitLabError,
  gitLabIssueCount,
  gitLabLoading,
  gitLabMilestones,
  gitLabNotice,
  selectedMilestoneTitle,
  strategy,
  onActiveWindowDaysChange,
  onLoad,
  onMilestoneChange,
  onStrategyChange,
}: {
  activeWindowDays: number;
  gitLabConfig: GanttGitLabConfig;
  gitLabError: string | null;
  gitLabIssueCount: number;
  gitLabLoading: boolean;
  gitLabMilestones: GitLabGanttMilestone[];
  gitLabNotice: string | null;
  selectedMilestoneTitle: string;
  strategy: GitLabGanttIssueStrategy;
  onActiveWindowDaysChange: (days: number) => void;
  onLoad: () => void;
  onMilestoneChange: (title: string) => void;
  onStrategyChange: (strategy: GitLabGanttIssueStrategy) => void;
}) {
  return (
    <section className="border-b border-sky-100 bg-sky-50/80 px-4 py-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[220px_minmax(220px,1fr)_220px_160px] xl:items-end">
        <Field label="GitLab source">
          <select
            value={strategy}
            onChange={(event) => onStrategyChange(event.target.value as GitLabGanttIssueStrategy)}
            className="w-full rounded-md border border-sky-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="milestone">Milestone only</option>
            <option value="active">Active window</option>
          </select>
        </Field>
        <Field label="Milestone">
          <select
            value={selectedMilestoneTitle}
            onChange={(event) => onMilestoneChange(event.target.value)}
            disabled={strategy !== 'milestone'}
            className="w-full rounded-md border border-sky-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="">Choose milestone...</option>
            {gitLabMilestones.map((milestone) => (
              <option key={milestone.id} value={milestone.title}>
                {milestone.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Active window">
          <select
            value={String(activeWindowDays)}
            onChange={(event) => onActiveWindowDaysChange(Number(event.target.value))}
            disabled={strategy !== 'active'}
            className="w-full rounded-md border border-sky-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="14">Opened + closed in last 14 days</option>
            <option value="30">Opened + closed in last 30 days</option>
            <option value="45">Opened + closed in last 45 days</option>
            <option value="90">Opened + closed in last 90 days</option>
          </select>
        </Field>
        <button
          type="button"
          onClick={onLoad}
          disabled={gitLabLoading}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-sky-700 px-3 text-xs font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${gitLabLoading ? 'animate-spin' : ''}`} />
          {gitLabLoading ? 'Loading' : 'Load tasks'}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-sky-900">
        <span className="rounded border border-sky-200 bg-white px-2 py-1">
          Main scope: {gitLabConfig.mainScopePath}
        </span>
        <span className="rounded border border-sky-200 bg-white px-2 py-1">
          PM project: {gitLabConfig.pmProjectPath}
        </span>
        <span className="rounded border border-sky-200 bg-white px-2 py-1">
          Milestones: {gitLabMilestones.length}
        </span>
        <span className="rounded border border-sky-200 bg-white px-2 py-1">
          Loaded issues: {gitLabIssueCount}
        </span>
      </div>
      {gitLabNotice && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {gitLabNotice}
        </div>
      )}
      {gitLabError && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {gitLabError}
        </div>
      )}
    </section>
  );
}

function BetaWorkspace({
  document,
  peopleById,
  selectedTaskId,
  timeline,
  onPrimaryAssigneeChange,
  onPrimaryEstimateChange,
  onPrimaryRoleChange,
  onPrimaryStartChange,
  onSelectTask,
  onTaskPointerDown,
  onTaskTitleChange,
}: {
  document: GanttBuilderNewDocument;
  peopleById: Map<string, GanttBuilderPerson>;
  selectedTaskId: string | null;
  timeline: ReturnType<typeof buildTimelineModel>;
  onPrimaryAssigneeChange: (taskId: string, assigneeId: string) => void;
  onPrimaryEstimateChange: (taskId: string, estimateHours: number) => void;
  onPrimaryRoleChange: (taskId: string, role: ProjectRole | '') => void;
  onPrimaryStartChange: (taskId: string, startDate: string) => void;
  onSelectTask: (taskId: string) => void;
  onTaskPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    task: GanttBuilderTask,
    mode: TimelineInteractionMode
  ) => void;
  onTaskTitleChange: (taskId: string, title: string) => void;
}) {
  const { plan } = document;

  if (plan.tasks.length === 0) {
    return (
      <div className="border-t border-slate-200 p-8 text-sm text-slate-500">
        No tasks in this beta plan yet. Load GitLab tasks or import a classic plan to edit the beta
        grid and timeline.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <div style={{ width: TASK_GRID_WIDTH + timeline.totalWidth }}>
        <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white">
          <div
            className="sticky left-0 z-20 grid shrink-0 items-center border-r border-slate-200 bg-slate-100 px-3 text-[10px] font-semibold uppercase text-slate-500"
            style={{ width: TASK_GRID_WIDTH, height: HEADER_HEIGHT }}
          >
            <div className="grid items-center gap-2" style={{ gridTemplateColumns: TASK_GRID_TEMPLATE }}>
              <span>Task</span>
              <span>Start</span>
              <span>Hours</span>
              <span>Assignee</span>
              <span>Role</span>
              <span>End</span>
            </div>
          </div>
          <div
            className="relative grid shrink-0 bg-slate-50"
            style={{
              width: timeline.totalWidth,
              height: HEADER_HEIGHT,
              gridTemplateColumns: timeline.columns.map((column) => `${column.width}px`).join(' '),
            }}
          >
            {timeline.columns.map((column) => (
              <div
                key={column.id}
                className="border-r border-slate-200 px-2 py-1.5 text-center"
                title={`${column.dates[0]} - ${column.dates[column.dates.length - 1]}`}
              >
                <div className="text-[11px] font-semibold leading-4 text-slate-900">
                  {column.label}
                </div>
                <div className="text-[10px] leading-3 text-slate-500">{column.subLabel}</div>
              </div>
            ))}
            {timeline.todayLeft !== null && (
              <div
                className="pointer-events-none absolute top-0 h-full w-0.5 bg-sky-500"
                style={{ left: timeline.todayLeft }}
              />
            )}
          </div>
        </div>

        {plan.tasks.map((task) => (
          <TaskTimelineRow
            key={task.id}
            task={task}
            plan={plan}
            peopleById={peopleById}
            selected={task.id === selectedTaskId}
            timeline={timeline}
            onPrimaryAssigneeChange={onPrimaryAssigneeChange}
            onPrimaryEstimateChange={onPrimaryEstimateChange}
            onPrimaryRoleChange={onPrimaryRoleChange}
            onPrimaryStartChange={onPrimaryStartChange}
            onSelect={() => onSelectTask(task.id)}
            onTaskPointerDown={onTaskPointerDown}
            onTaskTitleChange={onTaskTitleChange}
          />
        ))}
      </div>
    </div>
  );
}

function TaskTimelineRow({
  task,
  plan,
  peopleById,
  selected,
  timeline,
  onPrimaryAssigneeChange,
  onPrimaryEstimateChange,
  onPrimaryRoleChange,
  onPrimaryStartChange,
  onSelect,
  onTaskPointerDown,
  onTaskTitleChange,
}: {
  task: GanttBuilderTask;
  plan: GanttBuilderNewDocument['plan'];
  peopleById: Map<string, GanttBuilderPerson>;
  selected: boolean;
  timeline: ReturnType<typeof buildTimelineModel>;
  onPrimaryAssigneeChange: (taskId: string, assigneeId: string) => void;
  onPrimaryEstimateChange: (taskId: string, estimateHours: number) => void;
  onPrimaryRoleChange: (taskId: string, role: ProjectRole | '') => void;
  onPrimaryStartChange: (taskId: string, startDate: string) => void;
  onSelect: () => void;
  onTaskPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    task: GanttBuilderTask,
    mode: TimelineInteractionMode
  ) => void;
  onTaskTitleChange: (taskId: string, title: string) => void;
}) {
  const bar = getTimelineBar(task, peopleById, plan.nonWorkingDates, timeline.datePositions);
  const assigneeNames = getTaskAssigneeNames(task, peopleById);
  const primaryAssignment = getPrimaryAssignment(task);
  const primaryAssigneeId = primaryAssignment?.assigneeIds[0] ?? '';
  const primaryEstimateHours = primaryAssignment?.estimateHours ?? getTaskTotalEstimateHours(task);
  const primaryRole = primaryAssignment?.role ?? '';
  const primaryStartDate = primaryAssignment?.startDate ?? task.startDate;
  const endDate = getTaskEndDate(task, plan.people, plan.nonWorkingDates);
  const isOutside = task.startDate < timeline.firstDate || endDate > timeline.lastDate;

  return (
    <div
      onClick={onSelect}
      className={`flex w-full text-left transition ${
        selected ? 'bg-sky-50' : 'bg-white hover:bg-slate-50'
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <div
        className={`sticky left-0 z-[2] grid shrink-0 items-center gap-2 border-r border-t px-3 ${
          selected ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white'
        }`}
        style={{ width: TASK_GRID_WIDTH, gridTemplateColumns: TASK_GRID_TEMPLATE }}
      >
        <div className="min-w-0">
          <input
            type="text"
            value={task.title}
            aria-label="Task title"
            title={assigneeNames}
            onChange={(event) => onTaskTitleChange(task.id, event.target.value)}
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-slate-900 outline-none focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100"
          />
        </div>
        <input
          type="date"
          value={primaryStartDate}
          aria-label="Start date"
          onChange={(event) => onPrimaryStartChange(task.id, event.target.value)}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        />
        <input
          type="number"
          min={MIN_TASK_ESTIMATE_HOURS}
          step={0.25}
          value={primaryEstimateHours}
          aria-label="Estimate hours"
          onChange={(event) => onPrimaryEstimateChange(task.id, event.target.valueAsNumber)}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-right text-xs font-semibold tabular-nums text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        />
        <select
          value={primaryAssigneeId}
          aria-label="Primary assignee"
          onChange={(event) => onPrimaryAssigneeChange(task.id, event.target.value)}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        >
          <option value="">Unassigned</option>
          {plan.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <select
          value={primaryRole}
          aria-label="Primary role"
          onChange={(event) => onPrimaryRoleChange(task.id, event.target.value as ProjectRole | '')}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        >
          <option value="">No role</option>
          {PROJECT_ROLE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="truncate text-right text-[11px] tabular-nums text-slate-500">{endDate}</div>
      </div>
      <div
        className="relative shrink-0 border-t border-slate-100"
        style={{ width: timeline.totalWidth, height: ROW_HEIGHT }}
      >
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: timeline.columns.map((column) => `${column.width}px`).join(' '),
          }}
        >
          {timeline.columns.map((column) => {
            const allNonWorking = column.dates.every(
              (date) => !isPlanWorkingDay(date, plan.nonWorkingDates)
            );
            return (
              <div
                key={column.id}
                className={`border-r border-slate-100 ${
                  allNonWorking ? 'bg-amber-50/70' : 'bg-white'
                }`}
              />
            );
          })}
        </div>
        {timeline.todayLeft !== null && (
          <div
            className="pointer-events-none absolute top-0 h-full w-0.5 bg-sky-500/70"
            style={{ left: timeline.todayLeft }}
          />
        )}
        {bar && (
          <div
            onPointerDown={(event) => onTaskPointerDown(event, task, 'move')}
            className={`absolute top-3 flex h-9 touch-none select-none items-center overflow-hidden rounded-md border px-2 pr-4 text-[11px] font-semibold shadow-sm ${
              isOutside
                ? 'cursor-grab border-amber-300 bg-amber-100 text-amber-950'
                : selected
                  ? 'cursor-grab border-sky-400 bg-sky-100 text-sky-950'
                  : 'cursor-grab border-slate-300 bg-slate-100 text-slate-800'
            }`}
            style={{ left: bar.left, width: Math.max(12, bar.width) }}
            title={`${task.title}: ${task.startDate} - ${endDate}`}
          >
            <GripHorizontal className="mr-1 h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">{task.title}</span>
            <span className="ml-auto shrink-0 pl-2 tabular-nums">
              {getTaskTotalEstimateHours(task)}h
            </span>
            <button
              type="button"
              aria-label="Resize task estimate"
              onPointerDown={(event) => onTaskPointerDown(event, task, 'resize')}
              className="absolute right-0 top-0 h-full w-3 cursor-ew-resize border-l border-black/10 bg-white/20 hover:bg-white/40"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function WorkloadPanel({
  people,
  loadsByPersonId,
  selectedPanel,
  onSelectPanel,
}: {
  people: GanttBuilderPerson[];
  loadsByPersonId: ReturnType<typeof buildCapacityWeekLoads>;
  selectedPanel: 'workload' | 'conflicts';
  onSelectPanel: (panel: 'workload' | 'conflicts') => void;
}) {
  const weeks = Array.from(
    new Set(Object.values(loadsByPersonId).flatMap((loads) => loads.map((load) => load.weekStart)))
  ).sort();

  return (
    <section className="min-w-0 border-r border-slate-200 bg-white">
      <PanelTabHeader
        icon={<Users className="h-4 w-4" />}
        label="Workload"
        active={selectedPanel === 'workload'}
        onClick={() => onSelectPanel('workload')}
      />
      <div className="overflow-auto p-3">
        {weeks.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            No scheduled workload yet.
          </div>
        ) : (
          <div style={{ minWidth: Math.max(520, 160 + weeks.length * 96) }}>
            <div className="grid border-b border-slate-200 pb-1 text-[10px] font-semibold uppercase text-slate-500" style={{ gridTemplateColumns: `160px repeat(${weeks.length}, 96px)` }}>
              <div>Person</div>
              {weeks.map((week) => (
                <div key={week} className="px-1 text-center">
                  {formatShortDate(week)}
                </div>
              ))}
            </div>
            {people.map((person) => {
              const loads = new Map((loadsByPersonId[person.id] ?? []).map((load) => [load.weekStart, load]));
              return (
                <div
                  key={person.id}
                  className="grid items-center border-b border-slate-100 py-1.5"
                  style={{ gridTemplateColumns: `160px repeat(${weeks.length}, 96px)` }}
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate text-xs font-semibold text-slate-800">{person.name}</div>
                    <div className="text-[10px] text-slate-500">{getRoleLabel(person.role)}</div>
                  </div>
                  {weeks.map((week) => {
                    const load = loads.get(week);
                    const ratio = load ? load.hours / Math.max(1, load.capacityHours) : 0;
                    const tone =
                      ratio > 1
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : ratio >= 0.8
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700';
                    return (
                      <div key={week} className="px-1">
                        <div className={`rounded border px-1.5 py-1 text-center text-[11px] font-semibold tabular-nums ${tone}`}>
                          {load ? `${load.hours}/${load.capacityHours}h` : '0h'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ConflictPanel({
  conflicts,
  selectedPanel,
  onSelectPanel,
  onSelectTask,
}: {
  conflicts: ReturnType<typeof buildGanttBuilderNewConflicts>;
  selectedPanel: 'workload' | 'conflicts';
  onSelectPanel: (panel: 'workload' | 'conflicts') => void;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <section className="bg-white">
      <PanelTabHeader
        icon={<AlertTriangle className="h-4 w-4" />}
        label="Conflicts"
        active={selectedPanel === 'conflicts'}
        onClick={() => onSelectPanel('conflicts')}
      />
      <div className="max-h-64 overflow-auto p-3">
        {conflicts.length === 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            No beta conflicts detected.
          </div>
        ) : (
          <div className="space-y-2">
            {conflicts.map((conflict) => (
              <button
                key={conflict.id}
                type="button"
                onClick={() => conflict.taskId && onSelectTask(conflict.taskId)}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                  conflict.severity === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <div className="font-semibold">{conflict.message}</div>
                {conflict.reference && (
                  <div className="mt-0.5 truncate text-[11px] opacity-75">{conflict.reference}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TaskInspector({
  task,
  peopleById,
  onClose,
}: {
  task: GanttBuilderTask;
  peopleById: Map<string, GanttBuilderPerson>;
  onClose: () => void;
}) {
  return (
    <aside className="fixed bottom-0 right-0 top-[80px] z-30 w-full max-w-md overflow-auto border-l border-slate-200 bg-white shadow-2xl">
      <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase text-sky-700">Beta task inspector</div>
          <h3 className="mt-1 truncate text-base font-semibold text-slate-900">{task.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
      <div className="space-y-4 p-4 text-sm">
        <InfoBlock icon={<CalendarRange className="h-4 w-4" />} label="Schedule">
          <div>Start: {task.startDate}</div>
          <div>Total estimate: {getTaskTotalEstimateHours(task)}h</div>
        </InfoBlock>
        <InfoBlock icon={<Users className="h-4 w-4" />} label="Assignments">
          <div className="space-y-2">
            {task.assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="font-semibold text-slate-800">{getRoleLabel(assignment.role)}</div>
                <div className="text-xs text-slate-500">
                  {assignment.assigneeIds.length === 0
                    ? 'Unassigned'
                    : assignment.assigneeIds
                        .map((personId) => {
                          const person = peopleById.get(personId);
                          return `${person?.name ?? 'Unknown'} ${getAssignmentPersonHours(assignment, personId)}h from ${getAssignmentPersonStartDate(assignment, personId)}`;
                        })
                        .join(', ')}
                </div>
              </div>
            ))}
          </div>
        </InfoBlock>
        {task.source === 'gitlab' && (
          <InfoBlock icon={<GitBranch className="h-4 w-4" />} label="GitLab facts">
            <div>{task.issueProjectPath}#{task.issueIid}</div>
            <div>State: {task.gitlabState ?? 'unknown'}</div>
            <div>Spent: {task.gitlabSpentHours ?? 0}h / estimate {task.gitlabTimeEstimateHours ?? 0}h</div>
          </InfoBlock>
        )}
      </div>
    </aside>
  );
}

function PanelTabHeader({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs font-semibold ${
        active
          ? 'border-sky-200 bg-sky-50 text-sky-900'
          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-sky-800">
        {label}
      </span>
      {children}
    </label>
  );
}

function InfoBlock({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
        {icon}
        {label}
      </div>
      <div className="space-y-1 px-3 py-2 text-xs text-slate-600">{children}</div>
    </section>
  );
}

function ViewButton({
  active,
  label,
  disabled,
  onClick,
}: {
  active: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}

function setZoom(document: GanttBuilderNewDocument, zoom: GanttBuilderNewZoom) {
  return {
    ...document,
    view: {
      ...document.view,
      zoom,
    },
  };
}

function updatePlanTask(
  plan: GanttBuilderNewDocument['plan'],
  taskId: string,
  patch: Partial<GanttBuilderTask>
): GanttBuilderNewDocument['plan'] {
  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...patch,
          }
        : task
    ),
    updatedAt: new Date().toISOString(),
  };
}

function updateTaskPrimaryAssignment(
  plan: GanttBuilderNewDocument['plan'],
  taskId: string,
  patch: Partial<GanttBuilderTaskAssignment>
): GanttBuilderNewDocument['plan'] {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => {
      if (task.id !== taskId) return task;

      const current = getPrimaryAssignment(task) ?? createTaskAssignment({ startDate: task.startDate });
      const assigneeIds =
        patch.assigneeIds !== undefined ? Array.from(new Set(patch.assigneeIds)) : current.assigneeIds;
      const estimateHours =
        patch.estimateHours !== undefined
          ? normalizeEstimateHours(patch.estimateHours)
          : current.estimateHours;
      const startDate = patch.startDate !== undefined ? patch.startDate : current.startDate;
      const nextAssignment: GanttBuilderTaskAssignment = {
        ...current,
        role: patch.role !== undefined ? patch.role : current.role,
        estimateHours,
        startDate,
        assigneeIds,
        personEstimates: syncAssignmentPersonEstimates(
          assigneeIds,
          estimateHours,
          patch.personEstimates ??
            (patch.estimateHours !== undefined ? undefined : current.personEstimates)
        ),
        personStartDates: syncAssignmentPersonStartDates(
          assigneeIds,
          startDate,
          patch.personStartDates ??
            (patch.startDate !== undefined ? undefined : current.personStartDates)
        ),
      };
      const nextTask: GanttBuilderTask = {
        ...task,
        assignments: [nextAssignment, ...task.assignments.slice(1)],
      };

      return {
        ...nextTask,
        startDate: getTaskEarliestStartDate(nextTask),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

function resizeTaskPrimaryEstimate(
  plan: GanttBuilderNewDocument['plan'],
  taskId: string,
  estimateHours: number
) {
  return updateTaskPrimaryAssignment(plan, taskId, {
    estimateHours: normalizeEstimateHours(estimateHours),
  });
}

function moveTaskSchedule(
  plan: GanttBuilderNewDocument['plan'],
  taskId: string,
  targetStartDate: string
): GanttBuilderNewDocument['plan'] {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task || !isIsoDate(targetStartDate)) return plan;

  const originStartDate = getTaskEarliestStartDate(task);
  const direction = daysBetween(originStartDate, targetStartDate);
  const nextStartDate = resolvePlanWorkingDate(targetStartDate, plan.nonWorkingDates, direction);
  const deltaDays = daysBetween(originStartDate, nextStartDate);
  if (deltaDays === 0) return plan;

  const shiftDate = (date: string) =>
    resolvePlanWorkingDate(addDays(date, deltaDays), plan.nonWorkingDates, deltaDays);

  return {
    ...plan,
    tasks: plan.tasks.map((candidate) =>
      candidate.id === taskId
        ? {
            ...candidate,
            startDate: shiftDate(candidate.startDate),
            assignments: candidate.assignments.map((assignment) => ({
              ...assignment,
              startDate: shiftDate(assignment.startDate),
              personStartDates: assignment.personStartDates
                ? Object.fromEntries(
                    Object.entries(assignment.personStartDates).map(([personId, startDate]) => [
                      personId,
                      shiftDate(startDate),
                    ])
                  )
                : undefined,
            })),
          }
        : candidate
    ),
    updatedAt: new Date().toISOString(),
  };
}

function getPrimaryAssignment(task: GanttBuilderTask) {
  return task.assignments[0] ?? null;
}

function getTaskEarliestStartDate(task: GanttBuilderTask) {
  return (
    [
      task.startDate,
      ...task.assignments.flatMap((assignment) => [
        assignment.startDate,
        ...Object.values(assignment.personStartDates ?? {}),
      ]),
    ]
      .filter(isIsoDate)
      .sort()[0] ?? task.startDate
  );
}

function syncAssignmentPersonEstimates(
  assigneeIds: string[],
  estimateHours: number,
  existing?: Record<string, number>
) {
  if (assigneeIds.length === 0) return undefined;
  const fallback = normalizeEstimateHours(estimateHours);
  return Object.fromEntries(
    assigneeIds.map((personId) => [
      personId,
      normalizeEstimateHours(existing?.[personId] ?? fallback),
    ])
  );
}

function syncAssignmentPersonStartDates(
  assigneeIds: string[],
  startDate: string,
  existing?: Record<string, string>
) {
  if (assigneeIds.length === 0) return undefined;
  return Object.fromEntries(
    assigneeIds.map((personId) => [personId, existing?.[personId] ?? startDate])
  );
}

function resolvePlanWorkingDate(date: string, nonWorkingDates: string[], direction: number) {
  if (!isIsoDate(date)) return date;
  if (direction >= 0) return nextWorkingDate(date, nonWorkingDates);

  let cursor = date;
  let attempts = 0;
  while (!isPlanWorkingDay(cursor, nonWorkingDates) && attempts < 370) {
    cursor = addDays(cursor, -1);
    attempts += 1;
  }
  return isPlanWorkingDay(cursor, nonWorkingDates)
    ? cursor
    : nextWorkingDate(date, nonWorkingDates);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(date: string, days: number) {
  const timestamp = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(timestamp)) return date;
  return new Date(timestamp + days * 86400000).toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86400000);
}

function buildTimelineModel(dates: string[], zoom: GanttBuilderNewZoom, showWeekends: boolean) {
  const visibleDates = showWeekends ? dates : dates.filter(isWorkingDay);
  const columns = groupTimelineColumns(visibleDates, zoom);
  const datePositions = new Map<string, DatePosition>();
  let cursor = 0;

  for (const column of columns) {
    const unit = column.width / Math.max(1, column.dates.length);
    column.dates.forEach((date, index) => {
      datePositions.set(date, {
        left: cursor + index * unit,
        width: unit,
      });
    });
    cursor += column.width;
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayPosition = datePositions.get(today);
  const firstColumn = columns[0];
  const dragStepWidth = firstColumn
    ? firstColumn.width / Math.max(1, firstColumn.dates.length)
    : 52;

  return {
    columns,
    datePositions,
    dragStepWidth,
    totalWidth: Math.max(cursor, 640),
    todayLeft: todayPosition ? todayPosition.left + todayPosition.width / 2 : null,
    firstDate: visibleDates[0] ?? '',
    lastDate: visibleDates[visibleDates.length - 1] ?? '',
  };
}

function groupTimelineColumns(dates: string[], zoom: GanttBuilderNewZoom): TimelineColumn[] {
  if (zoom === 'day') {
    return dates.map((date) => ({
      id: date,
      label: formatDay(date),
      subLabel: formatWeekday(date),
      dates: [date],
      width: 52,
    }));
  }

  const groups = new Map<string, string[]>();
  for (const date of dates) {
    const key = zoom === 'week' ? getWeekStart(date) : date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), date]);
  }

  return Array.from(groups.entries()).map(([key, groupDates]) => ({
    id: key,
    label: zoom === 'week' ? formatShortDate(key) : formatMonth(key),
    subLabel:
      zoom === 'week'
        ? `${formatDay(groupDates[0])}-${formatDay(groupDates[groupDates.length - 1])}`
        : String(new Date(`${key}-01T00:00:00Z`).getUTCFullYear()),
    dates: groupDates,
    width: zoom === 'week' ? Math.max(82, groupDates.length * 18) : Math.max(120, groupDates.length * 12),
  }));
}

function getTimelineBar(
  task: GanttBuilderTask,
  peopleById: Map<string, GanttBuilderPerson>,
  nonWorkingDates: string[],
  datePositions: Map<string, DatePosition>
) {
  const scheduledDates = Array.from(
    new Set(getTaskScheduleEntries(task, peopleById, nonWorkingDates).map((entry) => entry.date))
  )
    .filter((date) => datePositions.has(date))
    .sort();
  if (scheduledDates.length === 0) return null;

  const first = datePositions.get(scheduledDates[0]);
  const last = datePositions.get(scheduledDates[scheduledDates.length - 1]);
  if (!first || !last) return null;

  return {
    left: first.left + 3,
    width: last.left + last.width - first.left - 6,
  };
}

function getTaskAssigneeNames(
  task: GanttBuilderTask,
  peopleById: Map<string, GanttBuilderPerson>
) {
  const names = Array.from(
    new Set(
      task.assignments.flatMap((assignment) =>
        assignment.assigneeIds.map((personId) => peopleById.get(personId)?.name ?? 'Unknown')
      )
    )
  );
  return names.length > 0 ? names.join(', ') : 'Unassigned';
}

function getWeekStart(date: string) {
  const timestamp = new Date(`${date}T00:00:00Z`).getTime();
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return new Date(timestamp + mondayOffset * 86400000).toISOString().slice(0, 10);
}

function dedupeGitLabIssues(issues: GitLabGanttIssue[]) {
  const byKey = new Map<string, GitLabGanttIssue>();
  for (const issue of issues) {
    byKey.set(`${issue.projectPath}#${issue.iid}`, issue);
  }
  return Array.from(byKey.values()).sort(
    (left, right) =>
      left.projectPath.localeCompare(right.projectPath) || Number(left.iid) - Number(right.iid)
  );
}

function dedupeMilestones(milestones: GitLabGanttMilestone[]) {
  const byTitle = new Map<string, GitLabGanttMilestone>();
  for (const milestone of milestones) {
    const existing = byTitle.get(milestone.title);
    if (!existing || (!existing.startDate && milestone.startDate)) {
      byTitle.set(milestone.title, milestone);
    }
  }
  return Array.from(byTitle.values()).sort((left, right) => left.title.localeCompare(right.title));
}

function getUpdatedAfterIso(windowDays: number) {
  const safeDays = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 45;
  return new Date(Date.now() - safeDays * 86400000).toISOString();
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

function formatWeekday(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatMonth(month: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(
    new Date(`${month}-01T00:00:00Z`)
  );
}
