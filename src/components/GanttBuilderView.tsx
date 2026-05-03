import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  Copy,
  Download,
  GripHorizontal,
  ListPlus,
  Plus,
  Save,
  RefreshCw,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  UserPlus,
  Users,
} from 'lucide-react';
import { usePlanHistory, isEditableTarget } from '../lib/usePlanHistory';
import { buildPngFilename, exportElementToPng } from '../lib/exportPng';
import type { ReportResult } from '../types';
import {
  GitLabClient,
  type GitLabGanttIssue,
  type GitLabGanttIssueStrategy,
  type GitLabGanttMilestone,
} from '../lib/gitlab';
import { PROJECT_ROLE_OPTIONS, type ProjectRole } from '../lib/planning';
import {
  DEFAULT_TASK_ESTIMATE_HOURS,
  buildCapacityWeekLoads,
  buildGanttBuilderCalendarDates,
  createGanttBuilderContext,
  createGitLabGanttBuilderPlan,
  createManualPerson,
  createTask,
  createTaskAssignment,
  getDailyCapacityHours,
  getAssignmentPersonStartDate,
  getGanttBuilderStorageKey,
  getAssignmentPersonHours,
  getRoleLabel,
  getTaskLaneHours,
  getTaskEndDate,
  getTaskScheduleEntries,
  getTaskTotalEstimateHours,
  isPlanWorkingDay,
  isWorkingDay,
  loadGanttBuilderPlan,
  nextWorkingDate,
  normalizeCapacityHours,
  normalizeEstimateHours,
  parseBulkTasks,
  saveGanttBuilderPlan,
  type CapacityWeekLoad,
  type GanttBuilderPerson,
  type GanttBuilderPlan,
  type GanttBuilderTask,
  type GanttBuilderTaskAssignment,
} from '../lib/ganttBuilder';

interface Props {
  report?: ReportResult | null;
  gitLabConfig?: GanttGitLabConfig | null;
  onBack: () => void;
}

interface GanttGitLabConfig {
  instanceOrigin: string;
  token: string;
  mainScopePath: string;
  pmProjectPath: string;
}

type RoleFilter = ProjectRole | 'all' | 'none';
type BuilderMode = 'manual' | 'gitlab';
type BuilderPage = 'tasks' | 'weekly' | 'calendar' | 'matrix';
type InteractionMode = 'move' | 'resize';

interface DragState {
  taskId: string;
  assignmentId: string;
  laneId: string;
  mode: InteractionMode;
  originClientX: number;
  originStartIndex: number;
  originWorkDays: number;
  originEstimateHours: number;
}

interface Lane {
  id: string;
  label: string;
  person: GanttBuilderPerson | null;
}

interface PersonColor {
  fill: string;
  strong: string;
  border: string;
  text: string;
}

const UNASSIGNED_LANE_ID = '__unassigned__';
const DAY_WIDTH = 88;
const MATRIX_DAY_WIDTH = 112;
const LANE_WIDTH = 260;
const MIN_LANE_HEIGHT = 132;
const BAR_HEIGHT = 36;
const BAR_TOP_OFFSET = 12;
const BAR_SLOT_GAP = 8;
const BAR_TITLE_MAX_LENGTH = 12;
const PM_ROLES = new Set<ProjectRole>(['pm', 'leadPm', 'analytic']);
const ALL_TASK_ASSIGNMENTS_ID = '__all_task_assignments__';

export function GanttBuilderView({ report, gitLabConfig, onBack }: Props) {
  const baseContext = useMemo(() => createGanttBuilderContext(report ?? undefined), [report]);
  const [builderMode, setBuilderMode] = useState<BuilderMode>('manual');
  const [gitLabPeriod, setGitLabPeriod] = useState(baseContext.period);
  const context = useMemo(
    () =>
      builderMode === 'gitlab'
        ? {
            ...baseContext,
            projectPath: gitLabConfig?.mainScopePath ?? baseContext.projectPath,
            period: gitLabPeriod,
            source: 'report' as const,
          }
        : baseContext,
    [baseContext, builderMode, gitLabConfig?.mainScopePath, gitLabPeriod]
  );
  const planHistory = usePlanHistory<GanttBuilderPlan>(loadGanttBuilderPlan(context));
  const plan = planHistory.state;
  const setPlan = planHistory.setState;
  const resetPlanHistory = planHistory.resetHistory;
  const [savedPlanJson, setSavedPlanJson] = useState(() => JSON.stringify(plan));
  const [clipboardTask, setClipboardTask] = useState<GanttBuilderTask | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1600);
  }, []);
  const calendarExportRef = useRef<HTMLDivElement | null>(null);
  const tasksExportRef = useRef<HTMLDivElement | null>(null);
  const weeklyExportRef = useRef<HTMLDivElement | null>(null);
  const matrixExportRef = useRef<HTMLDivElement | null>(null);
  const realityExportRef = useRef<HTMLDivElement | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskEstimate, setTaskEstimate] = useState(String(DEFAULT_TASK_ESTIMATE_HOURS));
  const [taskRole, setTaskRole] = useState<ProjectRole | null>(null);
  const [taskAssigneeIds, setTaskAssigneeIds] = useState<string[]>([]);
  const [bulkText, setBulkText] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [personFilter, setPersonFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [builderPage, setBuilderPage] = useState<BuilderPage>('calendar');
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [gitLabIssues, setGitLabIssues] = useState<GitLabGanttIssue[]>([]);
  const [gitLabMilestones, setGitLabMilestones] = useState<GitLabGanttMilestone[]>([]);
  const [taskSelectionStrategy, setTaskSelectionStrategy] =
    useState<GitLabGanttIssueStrategy>('milestone');
  const [selectedMilestoneTitle, setSelectedMilestoneTitle] = useState('');
  const [activeWindowDays, setActiveWindowDays] = useState(45);
  const [gitLabLoading, setGitLabLoading] = useState(false);
  const [gitLabError, setGitLabError] = useState<string | null>(null);
  const [gitLabNotice, setGitLabNotice] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  const storageKey = useMemo(() => getGanttBuilderStorageKey(context), [context]);

  useEffect(() => {
    if (builderMode === 'gitlab') return;
    const nextPlan = loadGanttBuilderPlan(context);
    resetPlanHistory(nextPlan);
    setSavedPlanJson(JSON.stringify(nextPlan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderMode, context, storageKey]);

  useEffect(() => {
    setGitLabPeriod(baseContext.period);
  }, [baseContext.period]);

  const loadGitLabPlan = async (
    options: {
      milestoneTitle?: string;
      strategy?: GitLabGanttIssueStrategy;
      windowDays?: number;
    } = {}
  ) => {
    if (!gitLabConfig) return;

    const milestoneTitle = options.milestoneTitle ?? selectedMilestoneTitle;
    const strategy = options.strategy ?? taskSelectionStrategy;
    const windowDays = options.windowDays ?? activeWindowDays;
    const updatedAfter = getUpdatedAfterIso(windowDays);

    setGitLabLoading(true);
    setGitLabError(null);
    setGitLabNotice(null);

    try {
      const client = new GitLabClient(gitLabConfig.instanceOrigin, gitLabConfig.token);
      const [mainMilestones, pmMilestones] = await Promise.all([
        client.fetchGanttMilestones(gitLabConfig.mainScopePath),
        client.fetchGanttMilestones(gitLabConfig.pmProjectPath),
      ]);

      const milestones = dedupeMilestones([...mainMilestones, ...pmMilestones]);
      const shouldLoadIssues = strategy !== 'milestone' || Boolean(milestoneTitle);
      const [mainIssues, pmIssues] = shouldLoadIssues
        ? await Promise.all([
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
          ])
        : [[], []];
      const issues = dedupeGitLabIssues([...mainIssues, ...pmIssues]);
      const selectedMilestone = milestones.find((milestone) => milestone.title === milestoneTitle);
      const nextPeriod =
        selectedMilestone?.startDate && selectedMilestone?.dueDate
          ? { start: selectedMilestone.startDate, end: selectedMilestone.dueDate }
          : baseContext.period;
      const nextContext = {
        ...baseContext,
        projectPath: gitLabConfig.mainScopePath,
        period: nextPeriod,
        source: 'report' as const,
      };
      const previousPlan = loadGanttBuilderPlan(nextContext);
      const nextPlan = createGitLabGanttBuilderPlan(nextContext, issues, previousPlan);

      setGitLabMilestones(milestones);
      setGitLabIssues(issues);
      setGitLabPeriod(nextPeriod);
      resetPlanHistory(nextPlan);
      setSavedPlanJson(JSON.stringify(nextPlan));
      if (strategy === 'milestone' && !milestoneTitle) {
        setGitLabNotice('Choose a milestone to load tasks. This prevents loading old GitLab tails.');
      }
    } catch (error) {
      setGitLabError(error instanceof Error ? error.message : 'Failed to load GitLab Gantt data');
    } finally {
      setGitLabLoading(false);
    }
  };

  useEffect(() => {
    if (builderMode !== 'gitlab' || !gitLabConfig) return;
    void loadGitLabPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderMode, gitLabConfig?.instanceOrigin, gitLabConfig?.mainScopePath, gitLabConfig?.pmProjectPath]);

  const dates = useMemo(() => buildGanttBuilderCalendarDates(plan, context), [context, plan]);
  const dateIndexByDate = useMemo(
    () => new Map(dates.map((date, index) => [date, index])),
    [dates]
  );
  const peopleById = useMemo(
    () => new Map(plan.people.map((person) => [person.id, person])),
    [plan.people]
  );
  const colorsByPersonId = useMemo(
    () =>
      Object.fromEntries(
        plan.people.map((person, index) => [person.id, buildPersonColor(index)])
      ) as Record<string, PersonColor>,
    [plan.people]
  );
  const capacityByPersonId = useMemo(() => buildCapacityWeekLoads(plan), [plan]);
  const filteredPeople = useMemo(
    () =>
      plan.people.filter((person) => {
        if (personFilter !== 'all' && personFilter !== 'unassigned' && person.id !== personFilter) {
          return false;
        }
        if (roleFilter === 'none') return !person.role;
        if (roleFilter !== 'all') return person.role === roleFilter;
        return true;
      }),
    [personFilter, plan.people, roleFilter]
  );

  const showUnassignedLane =
    personFilter === 'all' || personFilter === 'unassigned';
  const lanes = useMemo<Lane[]>(
    () => [
      ...filteredPeople
        .filter(() => personFilter !== 'unassigned')
        .map((person) => ({
          id: person.id,
          label: person.name,
          person,
        })),
      ...(showUnassignedLane
        ? [
            {
              id: UNASSIGNED_LANE_ID,
              label: 'Unassigned',
              person: null,
            },
          ]
        : []),
    ],
    [filteredPeople, personFilter, showUnassignedLane]
  );
  const visibleLaneIds = useMemo(() => new Set(lanes.map((lane) => lane.id)), [lanes]);
  const visibleTasks = useMemo(
    () =>
      plan.tasks
        .filter((task) =>
          taskMatchesFilters(task, {
            personFilter,
            roleFilter,
            visibleLaneIds,
          })
        )
        .sort(sortTasksByPlanOrder),
    [personFilter, plan.tasks, roleFilter, visibleLaneIds]
  );
  const overloadedWeeks = Object.values(capacityByPersonId)
    .flat()
    .filter((week) => week.overloaded).length;
  const planWarnings = useMemo(() => buildPlanWarnings(plan, context), [context, plan]);
  const hasUnsavedChanges = JSON.stringify(plan) !== savedPlanJson;
  const unassignedTaskCount = plan.tasks.filter((task) =>
    task.assignments.some((assignment) => assignment.assigneeIds.length === 0)
  ).length;
  const timelineWidth = dates.length * DAY_WIDTH;

  const handleSavePlan = () => {
    const changedTasks = countChangedTasks(savedPlanJson, plan);
    const message = [
      `Save local ${builderMode === 'gitlab' ? 'GitLab-based' : 'manual'} Gantt plan?`,
      `${changedTasks} changed task(s).`,
      planWarnings.length > 0 ? `${planWarnings.length} warning(s) will remain highlighted.` : null,
      builderMode === 'gitlab' ? 'GitLab will not be changed.' : null,
    ]
      .filter(Boolean)
      .join('\n');

    if (!window.confirm(message)) return;
    saveGanttBuilderPlan(context, plan);
    setSavedPlanJson(JSON.stringify(plan));
  };

  const handleCopySelection = useCallback(() => {
    const task = plan.tasks[0];
    if (!task) return;
    const target = clipboardTask ?? task;
    setClipboardTask(target);
    showToast(`Copied ${target.title || 'task'}`);
  }, [plan.tasks, clipboardTask, showToast]);

  const handlePasteSelection = useCallback(() => {
    if (!clipboardTask) {
      showToast('Clipboard is empty');
      return;
    }
    const cloned: GanttBuilderTask = {
      ...clipboardTask,
      id: `${clipboardTask.id}-copy-${Date.now().toString(36)}`,
      title: `${clipboardTask.title} (copy)`,
      assignments: clipboardTask.assignments.map((assignment) => ({
        ...assignment,
        id: `${assignment.id}-copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      })),
    };
    setPlan((current) => ({
      ...current,
      tasks: [...current.tasks, cloned],
      updatedAt: new Date().toISOString(),
    }));
    showToast('Pasted task');
  }, [clipboardTask, setPlan, showToast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        planHistory.undo();
        showToast('Undo');
      } else if ((key === 'y') || (key === 'z' && event.shiftKey)) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        planHistory.redo();
        showToast('Redo');
      } else if (key === 'c') {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        handleCopySelection();
      } else if (key === 'v') {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        handlePasteSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [planHistory, handleCopySelection, handlePasteSelection, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleExportPng = useCallback(
    async (ref: React.RefObject<HTMLElement>, label: string) => {
      if (!ref.current) return;
      try {
        await exportElementToPng(ref.current, buildPngFilename(label));
        showToast(`Exported ${label}.png`);
      } catch (err) {
        console.error('PNG export failed', err);
        showToast('Export failed');
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (!dragState) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = dragState.mode === 'resize' ? 'ew-resize' : 'grabbing';
    document.body.style.userSelect = 'none';

    const onPointerMove = (event: PointerEvent) => {
      const deltaDays = Math.round((event.clientX - dragState.originClientX) / DAY_WIDTH);

      setPlan((current) => {
        const task = current.tasks.find((candidate) => candidate.id === dragState.taskId);
        if (!task) return current;

        if (dragState.assignmentId === ALL_TASK_ASSIGNMENTS_ID) {
          const startIndex = clamp(dragState.originStartIndex + deltaDays, 0, dates.length - 1);
          return updateTaskAllAssignmentStartDates(
            current,
            task.id,
            nextWorkingDate(dates[startIndex], current.nonWorkingDates)
          );
        }

        if (dragState.mode === 'resize') {
          const assignee =
            dragState.laneId === UNASSIGNED_LANE_ID
              ? undefined
              : current.people.find((person) => person.id === dragState.laneId);
          const dailyCapacity = getDailyCapacityHours(assignee);
          const hourWidth = DAY_WIDTH / dailyCapacity;
          const rawDeltaPx = event.clientX - dragState.originClientX;
          const deltaHoursRaw = rawDeltaPx / hourWidth;
          const projected = dragState.originEstimateHours + deltaHoursRaw;
          const snapped =
            projected >= dailyCapacity
              ? Math.round(projected / dailyCapacity) * dailyCapacity
              : Math.max(1, Math.round(projected));
          const estimateHours = Math.max(0.25, normalizeEstimateHours(snapped));
          return updateTaskLaneEstimate(
            current,
            task.id,
            dragState.assignmentId,
            dragState.laneId,
            estimateHours
          );
        }

        const startIndex = clamp(dragState.originStartIndex + deltaDays, 0, dates.length - 1);
        const nextLaneId = getLaneIdAtPointer(event.clientY, rowsRef.current);
        const targetLaneId =
          nextLaneId && visibleLaneIds.has(nextLaneId) ? nextLaneId : dragState.laneId;

        return updateTaskLaneAssignee(
          current,
          task.id,
          dragState.assignmentId,
          dragState.laneId,
          targetLaneId,
          nextWorkingDate(dates[startIndex], current.nonWorkingDates)
        );
      });
    };

    const onPointerUp = () => setDragState(null);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dates, dragState, visibleLaneIds]);

  const handleCreateTask = () => {
    if (!taskTitle.trim()) return;

    const parsedEstimate = Number(String(taskEstimate).trim().replace(',', '.'));
    const estimateHours =
      Number.isFinite(parsedEstimate) && parsedEstimate > 0
        ? Math.max(0.25, parsedEstimate)
        : DEFAULT_TASK_ESTIMATE_HOURS;
    const task = createTask({
      title: taskTitle,
      estimateHours,
      assigneeIds: taskAssigneeIds,
      role: taskRole,
      startDate: nextWorkingDate(context.period.start, plan.nonWorkingDates),
    });

    setPlan((current) => ({
      ...current,
      tasks: [...current.tasks, task],
      updatedAt: new Date().toISOString(),
    }));
    setTaskTitle('');
    setTaskEstimate(String(DEFAULT_TASK_ESTIMATE_HOURS));
    setTaskRole(null);
  };

  const handleBulkAdd = () => {
    const tasks = parseBulkTasks(bulkText, {
      assigneeIds: taskAssigneeIds,
      role: taskRole,
      startDate: nextWorkingDate(context.period.start, plan.nonWorkingDates),
    });
    if (tasks.length === 0) return;

    setPlan((current) => ({
      ...current,
      tasks: [...current.tasks, ...tasks],
      updatedAt: new Date().toISOString(),
    }));
    setBulkText('');
  };

  const handleAddPerson = () => {
    if (!newPersonName.trim()) return;

    const person = createManualPerson(newPersonName);
    setPlan((current) => ({
      ...current,
      people: [...current.people, person],
      updatedAt: new Date().toISOString(),
    }));
    setNewPersonName('');
  };

  const handleToggleNonWorkingDate = (date: string) => {
    if (!isWorkingDay(date)) return;

    setPlan((current) => {
      const exists = current.nonWorkingDates.includes(date);
      return {
        ...current,
        nonWorkingDates: exists
          ? current.nonWorkingDates.filter((candidate) => candidate !== date)
          : [...current.nonWorkingDates, date].sort(),
        tasks: current.tasks.map((task) => ({
          ...task,
          startDate: nextWorkingDate(task.startDate, exists
            ? current.nonWorkingDates.filter((candidate) => candidate !== date)
            : [...current.nonWorkingDates, date]),
          assignments: task.assignments.map((assignment) => ({
            ...assignment,
            startDate: nextWorkingDate(
              assignment.startDate,
              exists
                ? current.nonWorkingDates.filter((candidate) => candidate !== date)
                : [...current.nonWorkingDates, date]
            ),
          })),
        })),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleTaskPointerDown = (
    event: ReactPointerEvent,
    laneId: string,
    task: GanttBuilderTask,
    assignmentId: string,
    mode: InteractionMode
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (assignmentId === ALL_TASK_ASSIGNMENTS_ID) {
      const earliestStartDate = getTaskEarliestStartDate(task);
      setDragState({
        taskId: task.id,
        assignmentId,
        laneId,
        mode,
        originClientX: event.clientX,
        originStartIndex: dateIndexByDate.get(earliestStartDate) ?? 0,
        originWorkDays: 1,
        originEstimateHours: getTaskTotalEstimateHours(task),
      });
      return;
    }

    const assignee = laneId === UNASSIGNED_LANE_ID ? undefined : peopleById.get(laneId);
    const assignment = task.assignments.find((candidate) => candidate.id === assignmentId);
    if (!assignment) return;
    const personId = laneId === UNASSIGNED_LANE_ID ? null : laneId;
    const laneHours = getAssignmentPersonHours(assignment, personId);
    setDragState({
      taskId: task.id,
      assignmentId,
      laneId,
      mode,
      originClientX: event.clientX,
      originStartIndex: dateIndexByDate.get(getAssignmentPersonStartDate(assignment, personId)) ?? 0,
      originWorkDays: getWorkDaysForLaneHours(laneHours, assignee),
      originEstimateHours: laneHours,
    });
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-950 px-5 py-4 text-white">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-white shadow-sm">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Gantt Builder</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-300">
                {builderMode === 'gitlab'
                  ? 'Use GitLab as the task source and freely edit a local plan layer. GitLab stays unchanged.'
                  : 'Build a manual plan from tasks, estimates, assignees, and weekly capacity. Bars can be dragged between people and resized by workday increments.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-200">
                <span className="rounded-md border border-white/10 bg-white/10 px-2 py-1">
                  {context.projectPath}
                </span>
                <span className="rounded-md border border-white/10 bg-white/10 px-2 py-1">
                  {context.period.start} - {context.period.end}
                </span>
                {context.source === 'standalone' && (
                  <span className="rounded-md border border-white/10 bg-white/10 px-2 py-1">
                    Standalone plan
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/10 px-2 py-1">
                  <Save className="h-3.5 w-3.5" />
                  {hasUnsavedChanges ? 'Unsaved local changes' : 'Saved locally'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-white/15 bg-white/10 p-0.5">
              <button
                type="button"
                onClick={() => setBuilderMode('manual')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  builderMode === 'manual' ? 'bg-white text-slate-900' : 'text-white hover:bg-white/10'
                }`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => setBuilderMode('gitlab')}
                disabled={!gitLabConfig}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  builderMode === 'gitlab' ? 'bg-white text-slate-900' : 'text-white hover:bg-white/10'
                }`}
              >
                Use GitLab
              </button>
            </div>
            <div className="inline-flex rounded-lg border border-white/15 bg-white/10 p-0.5">
              <button
                type="button"
                onClick={() => planHistory.undo()}
                disabled={!planHistory.canUndo}
                title="Undo (Ctrl+Z)"
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo
              </button>
              <button
                type="button"
                onClick={() => planHistory.redo()}
                disabled={!planHistory.canRedo}
                title="Redo (Ctrl+Y)"
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Redo2 className="h-3.5 w-3.5" />
                Redo
              </button>
            </div>
            <button
              type="button"
              onClick={handleSavePlan}
              disabled={!hasUnsavedChanges}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save local plan
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              {report ? 'Back to report' : 'Back'}
            </button>
          </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ListPlus className="h-5 w-5" />} label="Plan tasks" value={String(plan.tasks.length)} tone="sky" />
        <StatCard icon={<Users className="h-5 w-5" />} label="People" value={String(plan.people.length)} tone="emerald" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Unassigned" value={String(unassignedTaskCount)} tone="amber" />
        <StatCard icon={<SlidersHorizontal className="h-5 w-5" />} label="Overloaded weeks" value={String(overloadedWeeks)} tone={overloadedWeeks > 0 ? 'rose' : 'emerald'} />
      </div>

      {builderMode === 'gitlab' && planWarnings.length > 0 && (
        <section
          ref={realityExportRef}
          className="rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-950"
        >
          <div className="sticky top-0 z-[1] flex items-center justify-between gap-3 rounded-t-xl border-b border-amber-200 bg-amber-100/90 px-4 py-2.5 backdrop-blur">
            <div className="min-w-0">
              <div className="font-semibold">
                GitLab reality checks
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {planWarnings.length}
                </span>
              </div>
              <div className="text-[11px] text-amber-800">
                Local plan vs GitLab facts. Warnings do not block planning.
              </div>
            </div>
            <div className="flex items-center gap-1.5" data-export="ignore">
              <button
                type="button"
                onClick={() => {
                  const text = planWarnings.map((w) => w.message).join('\n');
                  void navigator.clipboard.writeText(text).then(() => showToast('Warnings copied'));
                }}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white/80 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-white"
                title="Copy all warnings"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
              <button
                type="button"
                onClick={() => void handleExportPng(realityExportRef, 'reality-checks')}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white/80 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-white"
                title="Export as PNG"
              >
                <Download className="h-3 w-3" />
                PNG
              </button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto px-4 py-3">
            <ul className="grid gap-1.5 text-xs">
              {planWarnings.map((warning) => (
                <li
                  key={warning.id}
                  className="rounded-lg border border-amber-200 bg-white/80 px-3 py-2"
                >
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-4">
          {builderMode === 'gitlab' && (
            <section className="overflow-hidden rounded-xl border border-sky-200 bg-sky-50/50 shadow-sm">
              <div className="border-b border-sky-200 bg-sky-100/80 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-950">
                  <RefreshCw className="h-4 w-4" />
                  GitLab source
                </div>
                <p className="mt-1 text-xs text-sky-800/80">
                  Tasks are loaded from GitLab and saved only as a local plan overlay.
                </p>
              </div>
              <div className="space-y-3 p-4">
                <FieldLabel label="Task selection strategy">
                  <select
                    value={taskSelectionStrategy}
                    onChange={(event) => {
                      const nextStrategy = event.target.value as GitLabGanttIssueStrategy;
                      setTaskSelectionStrategy(nextStrategy);
                      void loadGitLabPlan({ strategy: nextStrategy });
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="milestone">Milestone only (recommended)</option>
                    <option value="active">Active window</option>
                  </select>
                </FieldLabel>
                <FieldLabel label="Milestone">
                  <select
                    value={selectedMilestoneTitle}
                    onChange={(event) => {
                      const nextTitle = event.target.value;
                      setSelectedMilestoneTitle(nextTitle);
                      void loadGitLabPlan({ milestoneTitle: nextTitle });
                    }}
                    disabled={taskSelectionStrategy !== 'milestone'}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="">Choose milestone...</option>
                    {gitLabMilestones.map((milestone) => (
                      <option key={milestone.id} value={milestone.title}>
                        {milestone.title}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
                {taskSelectionStrategy === 'active' && (
                  <FieldLabel label="Recently closed window">
                    <select
                      value={String(activeWindowDays)}
                      onChange={(event) => {
                        const nextDays = Number(event.target.value);
                        setActiveWindowDays(nextDays);
                        void loadGitLabPlan({ strategy: 'active', windowDays: nextDays });
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
                    >
                      <option value="14">Opened + closed in last 14 days</option>
                      <option value="30">Opened + closed in last 30 days</option>
                      <option value="45">Opened + closed in last 45 days</option>
                      <option value="90">Opened + closed in last 90 days</option>
                    </select>
                  </FieldLabel>
                )}
                <div className="rounded-lg border border-sky-200 bg-white p-3 text-xs text-sky-900">
                  <div>Main scope: {gitLabConfig?.mainScopePath ?? 'not available'}</div>
                  <div>PM project: {gitLabConfig?.pmProjectPath ?? 'not available'}</div>
                  <div>Strategy: {getStrategyLabel(taskSelectionStrategy)}</div>
                  <div>Loaded issues: {gitLabIssues.length}</div>
                </div>
                {gitLabError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {gitLabError}
                  </div>
                )}
                {gitLabNotice && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {gitLabNotice}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void loadGitLabPlan()}
                  disabled={!gitLabConfig || gitLabLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${gitLabLoading ? 'animate-spin' : ''}`} />
                  {gitLabLoading ? 'Loading GitLab...' : 'Refresh from GitLab'}
                </button>
              </div>
            </section>
          )}

          {builderMode === 'manual' && (
          <section className="overflow-hidden rounded-xl border border-sky-200 bg-sky-50/50 shadow-sm">
            <div className="border-b border-sky-200 bg-sky-100/80 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-950">
                <Plus className="h-4 w-4" />
                Add task
              </div>
            </div>
            <div className="space-y-3 p-4">
              <FieldLabel label="Task title">
                <input
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="Task title"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-200"
                />
              </FieldLabel>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[90px_minmax(0,1fr)]">
                <FieldLabel label="Estimate">
                  <input
                    value={taskEstimate}
                    onChange={(event) => setTaskEstimate(event.target.value)}
                    inputMode="decimal"
                    aria-label="Estimate hours"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </FieldLabel>
                <FieldLabel label="Role">
                  <RoleSelect value={taskRole} onChange={setTaskRole} />
                </FieldLabel>
              </div>
              <FieldLabel label="People">
                <PeopleCheckboxList
                  people={plan.people}
                  selectedIds={taskAssigneeIds}
                  onChange={setTaskAssigneeIds}
                />
              </FieldLabel>
              <button
                type="button"
                onClick={handleCreateTask}
                disabled={!taskTitle.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Add task
              </button>
            </div>
          </section>
          )}

          {builderMode === 'manual' && (
          <section className="overflow-hidden rounded-xl border border-violet-200 bg-violet-50/50 shadow-sm">
            <div className="border-b border-violet-200 bg-violet-100/80 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-950">
                <ListPlus className="h-4 w-4" />
                Bulk add
              </div>
              <p className="mt-1 text-xs text-violet-800/80">
                One non-empty line becomes one task. Optional estimate examples: [16h] API, UI | 12h.
              </p>
            </div>
            <div className="p-4">
              <FieldLabel label="Task lines">
                <textarea
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  rows={7}
                  placeholder={'Auth backend\nLogin UI | 12h\n[16h] Settings page'}
                  className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-200"
                />
              </FieldLabel>
            <button
              type="button"
              onClick={handleBulkAdd}
              disabled={!bulkText.trim()}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListPlus className="h-4 w-4" />
              Add lines as tasks
            </button>
            </div>
          </section>
          )}

          <section className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/50 shadow-sm">
            <div className="border-b border-emerald-200 bg-emerald-100/80 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                <Users className="h-4 w-4" />
                People
              </div>
            </div>
            <div className="p-4">
            <div className="flex gap-2">
              <FieldLabel label="New developer" className="min-w-0 flex-1">
                <input
                  value={newPersonName}
                  onChange={(event) => setNewPersonName(event.target.value)}
                  placeholder="New developer"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-200"
                />
              </FieldLabel>
              <button
                type="button"
                onClick={handleAddPerson}
                disabled={!newPersonName.trim()}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                title="Add developer"
              >
                <UserPlus className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-[340px] space-y-2 overflow-auto pr-1">
              {plan.people.map((person) => (
                <PersonEditor
                  key={person.id}
                  person={person}
                  onChange={(patch) =>
                    setPlan((current) => updatePlanPerson(current, person.id, patch))
                  }
                  onDelete={
                    person.source === 'manual'
                      ? () => setPlan((current) => deletePerson(current, person.id))
                      : undefined
                  }
                />
              ))}
            </div>
            </div>
          </section>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm">
            <div className="border-b border-amber-200 bg-amber-100/80 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                </div>
                <p className="mt-1 text-xs text-amber-800/80">
                  Filter by developer, role, or unassigned tasks without changing the saved plan.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[520px]">
                <FieldLabel label="Developer filter">
                  <select
                    value={personFilter}
                    onChange={(event) => setPersonFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="all">All developers and unassigned</option>
                    <option value="unassigned">Unassigned only</option>
                    {plan.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
                <FieldLabel label="Role filter">
                  <select
                    value={roleFilter}
                    onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="all">All roles</option>
                    <option value="none">No role / unassigned</option>
                    {PROJECT_ROLE_OPTIONS.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
              </div>
            </div>
            </div>
          </div>

          <BuilderPageNav
            activePage={builderPage}
            onChange={setBuilderPage}
            taskCount={visibleTasks.length}
            peopleCount={filteredPeople.length}
            dateCount={dates.length}
            overloadedWeeks={overloadedWeeks}
          />

          {builderPage === 'tasks' && (
            <div ref={tasksExportRef} className="space-y-3">
              <div className="flex justify-end" data-export="ignore">
                <button
                  type="button"
                  onClick={() => void handleExportPng(tasksExportRef, 'tasks-table')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" />
                  Export PNG
                </button>
              </div>
              <TaskTableSection
              tasks={visibleTasks}
              people={plan.people}
              peopleById={peopleById}
              nonWorkingDates={plan.nonWorkingDates}
              onTaskChange={(taskId, patch) =>
                setPlan((current) => updatePlanTask(current, taskId, patch))
              }
              onAssignmentChange={(taskId, assignmentId, patch) =>
                setPlan((current) =>
                  updateTaskAssignment(current, taskId, assignmentId, patch)
                )
              }
              onAssignmentAdd={(taskId) =>
                setPlan((current) => addTaskAssignment(current, taskId))
              }
              onAssignmentDelete={(taskId, assignmentId) =>
                setPlan((current) => deleteTaskAssignment(current, taskId, assignmentId))
              }
              onTaskDelete={(taskId) => setPlan((current) => deleteTask(current, taskId))}
            />
            </div>
          )}

          {builderPage === 'weekly' && (
            <div ref={weeklyExportRef} className="space-y-3">
              <div className="flex justify-end" data-export="ignore">
                <button
                  type="button"
                  onClick={() => void handleExportPng(weeklyExportRef, 'weekly-load')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" />
                  Export PNG
                </button>
              </div>
              <WeeklyLoadPanel
                people={filteredPeople}
                tasks={plan.tasks}
                peopleById={peopleById}
                nonWorkingDates={plan.nonWorkingDates}
                loadsByPersonId={capacityByPersonId}
              />
            </div>
          )}

          {builderPage === 'calendar' && (
            <section
              ref={calendarExportRef}
              className="overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm"
            >
              <div className="flex justify-end px-4 pt-3" data-export="ignore">
                <button
                  type="button"
                  onClick={() => void handleExportPng(calendarExportRef, 'calendar-plan')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" />
                  Export PNG
                </button>
              </div>
            <div className="border-b border-indigo-200 bg-indigo-50 px-4 py-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-950">
                    <CalendarRange className="h-4 w-4" />
                    Calendar plan
                  </div>
                  <p className="mt-1 text-xs text-indigo-800/80">
                    Drag bars to change date or assignee. Resize the right edge to change estimate
                    and planned duration. Click a weekday in the header to mark it as an extra day
                    off.
                  </p>
                </div>
                <div className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-800">
                  {visibleTasks.length} visible task(s), {dates.length} day(s)
                </div>
              </div>
            </div>

            {lanes.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No lanes match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ width: LANE_WIDTH + timelineWidth }}>
                  <div className="flex border-b border-indigo-200 bg-indigo-100/70">
                    <div
                      className="shrink-0 border-r border-indigo-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-700"
                      style={{ width: LANE_WIDTH }}
                    >
                      Assignee
                    </div>
                    <div
                      className="grid shrink-0"
                      style={{
                        width: timelineWidth,
                        gridTemplateColumns: `repeat(${dates.length}, ${DAY_WIDTH}px)`,
                      }}
                    >
                      {dates.map((date) => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => handleToggleNonWorkingDate(date)}
                          disabled={!isWorkingDay(date)}
                          title={
                            !isWorkingDay(date)
                              ? 'Built-in weekend'
                              : plan.nonWorkingDates.includes(date)
                                ? 'Mark as working day'
                                : 'Mark as extra day off'
                          }
                          className={`border-r border-slate-200 px-1 py-1.5 text-center transition disabled:cursor-default ${
                            !isWorkingDay(date)
                              ? 'bg-amber-100/80'
                              : plan.nonWorkingDates.includes(date)
                                ? 'bg-rose-100 text-rose-950 hover:bg-rose-200'
                                : 'bg-white hover:bg-sky-50'
                          }`}
                        >
                          <div className="text-[11px] font-semibold leading-none text-slate-900">
                            {formatDay(date)}
                          </div>
                          <div className="mt-0.5 text-[9px] uppercase leading-none text-slate-500">
                            {formatWeekday(date)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div ref={rowsRef}>
                    {lanes.map((lane) => (
                      <GanttLaneRow
                        key={lane.id}
                        lane={lane}
                        dates={dates}
                        dateIndexByDate={dateIndexByDate}
                        tasks={visibleTasks.filter((task) =>
                          taskHasLaneWork(task, lane.id === UNASSIGNED_LANE_ID ? null : lane.id)
                        )}
                        capacityWeeks={lane.person ? capacityByPersonId[lane.person.id] || [] : []}
                        peopleById={peopleById}
                        nonWorkingDates={plan.nonWorkingDates}
                        colorsByPersonId={colorsByPersonId}
                        onTaskPointerDown={handleTaskPointerDown}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
          )}

          {builderPage === 'matrix' && (
            <div ref={matrixExportRef} className="space-y-3">
              <div className="flex justify-end" data-export="ignore">
                <button
                  type="button"
                  onClick={() => void handleExportPng(matrixExportRef, 'task-date-matrix')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" />
                  Export PNG
                </button>
              </div>
              <TaskDateMatrix
                tasks={visibleTasks}
                dates={dates}
                dateIndexByDate={dateIndexByDate}
                peopleById={peopleById}
                nonWorkingDates={plan.nonWorkingDates}
                colorsByPersonId={colorsByPersonId}
                onTaskPointerDown={handleTaskPointerDown}
                onTaskReorder={(draggedTaskId, targetTaskId) =>
                  setPlan((current) => reorderPlanTasks(current, draggedTaskId, targetTaskId))
                }
              />
            </div>
          )}

        </section>
      </div>
      {toast && (
        <div
          className="pointer-events-none fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function BuilderPageNav({
  activePage,
  onChange,
  taskCount,
  peopleCount,
  dateCount,
  overloadedWeeks,
}: {
  activePage: BuilderPage;
  onChange: (page: BuilderPage) => void;
  taskCount: number;
  peopleCount: number;
  dateCount: number;
  overloadedWeeks: number;
}) {
  const pages: {
    id: BuilderPage;
    label: string;
    description: string;
    meta: string;
    icon: ReactNode;
  }[] = [
    {
      id: 'tasks',
      label: 'Task table',
      description: 'Edit task metadata, roles, estimates, dates, and assignees.',
      meta: `${taskCount} task(s)`,
      icon: <ListPlus className="h-4 w-4" />,
    },
    {
      id: 'weekly',
      label: 'Weekly capacity',
      description: 'Review workload and overload by person and week.',
      meta: overloadedWeeks > 0 ? `${overloadedWeeks} overload(s)` : `${peopleCount} people`,
      icon: <Users className="h-4 w-4" />,
    },
    {
      id: 'calendar',
      label: 'Calendar plan',
      description: 'Drag bars across dates and people; resize duration.',
      meta: `${dateCount} day(s)`,
      icon: <CalendarRange className="h-4 w-4" />,
    },
    {
      id: 'matrix',
      label: 'Task/date',
      description: 'See scheduled work as task rows and date columns.',
      meta: `${taskCount} x ${dateCount}`,
      icon: <SlidersHorizontal className="h-4 w-4" />,
    },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">Builder pages</div>
        <p className="mt-1 text-xs text-slate-500">
          Switch between focused workspaces without changing the saved plan.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 xl:grid-cols-4">
        {pages.map((page) => {
          const active = activePage === page.id;
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => onChange(page.id)}
              aria-pressed={active}
              className={`rounded-xl border px-3 py-3 text-left transition ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {page.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{page.label}</div>
                    <div className={`mt-0.5 text-[11px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                      {page.meta}
                    </div>
                  </div>
                </div>
              </div>
              <p className={`mt-2 text-xs leading-5 ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                {page.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GanttLaneRow({
  lane,
  dates,
  dateIndexByDate,
  tasks,
  capacityWeeks,
  peopleById,
  nonWorkingDates,
  colorsByPersonId,
  onTaskPointerDown,
}: {
  lane: Lane;
  dates: string[];
  dateIndexByDate: Map<string, number>;
  tasks: GanttBuilderTask[];
  capacityWeeks: CapacityWeekLoad[];
  peopleById: Map<string, GanttBuilderPerson>;
  nonWorkingDates: string[];
  colorsByPersonId: Record<string, PersonColor>;
  onTaskPointerDown: (
    event: ReactPointerEvent,
    laneId: string,
    task: GanttBuilderTask,
    assignmentId: string,
    mode: InteractionMode
  ) => void;
}) {
  const timelineWidth = dates.length * MATRIX_DAY_WIDTH;
  const lanePersonId = lane.id === UNASSIGNED_LANE_ID ? null : lane.id;
  const laneItems = tasks.flatMap((task) =>
    task.assignments
      .filter((assignment) =>
        lane.id === UNASSIGNED_LANE_ID
          ? assignment.assigneeIds.length === 0
          : assignment.assigneeIds.includes(lane.id)
      )
      .map((assignment) => ({ task, assignment }))
  );
  const laneHeight = Math.max(
    MIN_LANE_HEIGHT,
    BAR_TOP_OFFSET * 2 +
      laneItems.reduce(
        (height, item) =>
          height + getLaneItemCalendarBarHeight(item, lanePersonId, peopleById, nonWorkingDates, dateIndexByDate) + BAR_SLOT_GAP,
        -BAR_SLOT_GAP
      )
  );

  return (
    <div
      data-lane-id={lane.id}
      className="flex border-b border-indigo-100 last:border-b-0"
      style={{ height: laneHeight }}
    >
      <div
        className={`shrink-0 border-r px-3 py-3 ${
          lane.person
            ? 'border-indigo-100 bg-slate-50'
            : 'border-amber-200 bg-amber-50'
        }`}
        style={{ width: LANE_WIDTH }}
      >
        <div className="flex h-full flex-col justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{lane.label}</div>
            <div className="mt-1 text-xs text-slate-500">
              {lane.person ? getRoleLabel(lane.person.role) : 'No developer assigned'}
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {lane.person ? (
              capacityWeeks.length > 0 ? (
                capacityWeeks.slice(0, 3).map((week) => (
                  <span
                    key={week.weekStart}
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      week.overloaded
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}
                    title={`Week ${week.weekStart}: ${week.hours}/${week.capacityHours}h`}
                  >
                    {formatShortDate(week.weekStart)} {week.hours}/{week.capacityHours}h
                  </span>
                ))
              ) : (
                <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                  0/{lane.person.weeklyCapacityHours}h
                </span>
              )
            ) : (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                {tasks.length} task(s)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="relative shrink-0 bg-white" style={{ width: timelineWidth }}>
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${dates.length}, ${DAY_WIDTH}px)` }}
        >
          {dates.map((date) => (
            <div
              key={date}
              className={`relative border-r border-slate-200 ${
                isPlanWorkingDay(date, nonWorkingDates)
                  ? ''
                  : nonWorkingDates.includes(date)
                    ? 'bg-rose-50/90'
                    : 'bg-amber-50/80'
              }`}
            >
              {isPlanWorkingDay(date, nonWorkingDates) && (
                <div
                  className="pointer-events-none absolute inset-0 opacity-50"
                  style={{
                    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${
                      DAY_WIDTH / 8 - 1
                    }px, rgba(148,163,184,0.25) ${DAY_WIDTH / 8 - 1}px, rgba(148,163,184,0.25) ${
                      DAY_WIDTH / 8
                    }px)`,
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {laneItems.map(({ task, assignment }, index) => {
          const assignee = lanePersonId ? peopleById.get(lanePersonId) : undefined;
          const scheduledEntries = getTaskScheduleEntries(task, peopleById, nonWorkingDates)
            .filter((entry) => entry.assignmentId === assignment.id && entry.personId === lanePersonId);
          const scheduledDates = Array.from(
            new Set(scheduledEntries.map((entry) => entry.date))
          ).sort();
          const firstScheduledDate = scheduledDates[0] ?? assignment.startDate;
          const startIndex = dateIndexByDate.get(firstScheduledDate) ?? 0;
          const endDate = scheduledDates[scheduledDates.length - 1] ?? firstScheduledDate;
          const endIndex = dateIndexByDate.get(endDate) ?? startIndex;
          const durationDays = endIndex - startIndex + 1;
          const laneHoursRaw = scheduledEntries.reduce((sum, entry) => sum + entry.hours, 0);
          const dailyCap = getDailyCapacityHours(assignee);
          const isHourScaled = durationDays === 1 && laneHoursRaw > 0 && laneHoursRaw < dailyCap;
          const hourWidth = DAY_WIDTH / dailyCap;
          const width = isHourScaled
            ? Math.max(hourWidth - 2, laneHoursRaw * hourWidth - 2)
            : Math.max(DAY_WIDTH - 8, (endIndex - startIndex + 1) * DAY_WIDTH - 8);
          const titleLabel =
            durationDays > 1 ? task.title.trim() : formatCalendarBarTitle(task.title);
          const barHeight = getCalendarBarHeight(titleLabel, width, durationDays);
          const top =
            BAR_TOP_OFFSET +
            laneItems
              .slice(0, index)
              .reduce(
                (height, item) =>
                  height + getLaneItemCalendarBarHeight(item, lanePersonId, peopleById, nonWorkingDates, dateIndexByDate) + BAR_SLOT_GAP,
                0
              );
          const left = startIndex * DAY_WIDTH + (isHourScaled ? 1 : 4);
          const color = lanePersonId ? colorsByPersonId[lanePersonId] : undefined;
          const laneHours = roundHours(scheduledEntries.reduce((sum, entry) => sum + entry.hours, 0));
          const warning = getAssignmentTimingWarning(task, assignment);
          const isTiny = width < 90;

          return (
            <div
              key={`${task.id}-${assignment.id}-${lane.id}`}
              onPointerDown={(event) =>
                onTaskPointerDown(event, lane.id, task, assignment.id, 'move')
              }
              className={`absolute flex cursor-grab items-center overflow-hidden rounded-md border text-xs font-semibold shadow-sm active:cursor-grabbing ${
                warning ? 'ring-2 ring-amber-400' : ''
              }`}
              style={{
                left,
                top,
                width,
                minHeight: barHeight,
                backgroundColor: color?.fill ?? '#fef3c7',
                borderColor: color?.border ?? '#f59e0b',
                color: color?.text ?? '#78350f',
              }}
              title={`${task.title} / ${getRoleLabel(assignment.role)}: ${laneHours}h on this lane, ${getWorkDaysForLaneHours(laneHours, assignee)} workday(s)${warning ? `. ${warning}` : ''}`}
            >
              {!isTiny && (
                <GripHorizontal className="ml-1 mr-1 h-3.5 w-3.5 shrink-0 opacity-60" />
              )}
              <div
                className={`min-w-0 flex-1 overflow-hidden px-1 ${
                  isTiny ? 'pr-3 text-center' : 'pr-3'
                }`}
              >
                <div className="truncate text-[10px] font-bold leading-3 tabular-nums">
                  {laneHours}h
                </div>
                <div
                  className={`text-[8px] font-semibold leading-3 opacity-90 ${
                    durationDays > 1 ? 'whitespace-normal break-words' : 'truncate'
                  }`}
                >
                  {titleLabel}
                </div>
                <div className="truncate text-[8px] font-semibold leading-3 opacity-75">
                  {getTaskBoardLabel(task)}
                </div>
              </div>
              <button
                type="button"
                onPointerDown={(event) =>
                  onTaskPointerDown(event, lane.id, task, assignment.id, 'resize')
                }
                className="absolute right-1 top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded-sm bg-black/15 transition hover:bg-black/25"
                title="Resize estimate"
                aria-label={`Resize ${task.title}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskDateMatrix({
  tasks,
  dates,
  dateIndexByDate,
  peopleById,
  nonWorkingDates,
  colorsByPersonId,
  onTaskPointerDown,
  onTaskReorder,
}: {
  tasks: GanttBuilderTask[];
  dates: string[];
  dateIndexByDate: Map<string, number>;
  peopleById: Map<string, GanttBuilderPerson>;
  nonWorkingDates: string[];
  colorsByPersonId: Record<string, PersonColor>;
  onTaskPointerDown: (
    event: ReactPointerEvent,
    laneId: string,
    task: GanttBuilderTask,
    assignmentId: string,
    mode: InteractionMode
  ) => void;
  onTaskReorder: (draggedTaskId: string, targetTaskId: string) => void;
}) {
  const timelineWidth = dates.length * DAY_WIDTH;

  return (
    <section className="overflow-hidden rounded-xl border border-cyan-200 bg-white shadow-sm">
      <div className="border-b border-cyan-200 bg-cyan-50 px-4 py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-950">
              <CalendarRange className="h-4 w-4" />
              Task/date matrix
            </div>
            <p className="mt-1 text-xs text-cyan-800/80">
              Rows are tasks, columns are dates, colored cells show who is scheduled to work.
            </p>
          </div>
          <div className="rounded-md border border-cyan-200 bg-white px-2 py-1 text-xs font-semibold text-cyan-800">
            {tasks.length} task row(s), {dates.length} date column(s)
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="p-8 text-sm text-slate-500">No tasks match the current filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ width: LANE_WIDTH + timelineWidth }}>
            <div className="flex border-b border-cyan-200 bg-cyan-100/70">
              <div
                className="shrink-0 border-r border-cyan-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700"
                style={{ width: LANE_WIDTH }}
              >
                Task
              </div>
              <div
                className="grid shrink-0"
                style={{
                  width: timelineWidth,
                  gridTemplateColumns: `repeat(${dates.length}, ${DAY_WIDTH}px)`,
                }}
              >
                {dates.map((date) => (
                  <div
                    key={date}
                    className={`border-r border-cyan-100 px-1 py-1.5 text-center ${
                      isPlanWorkingDay(date, nonWorkingDates)
                        ? 'bg-white'
                        : nonWorkingDates.includes(date)
                          ? 'bg-rose-100'
                          : 'bg-amber-100/80'
                    }`}
                    title={
                      isPlanWorkingDay(date, nonWorkingDates)
                        ? 'Working day'
                        : nonWorkingDates.includes(date)
                          ? 'Extra day off'
                          : 'Weekend'
                    }
                  >
                    <div className="text-[11px] font-semibold leading-none text-slate-900">
                      {formatDay(date)}
                    </div>
                    <div className="mt-0.5 text-[9px] uppercase leading-none text-slate-500">
                      {formatWeekday(date)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {tasks.map((task) => {
                const taskBar = getTaskDateBar(task, peopleById, nonWorkingDates, dateIndexByDate);
                const taskSummary = formatTaskAssignmentsSummary(task, peopleById);
                const rowHeight = getTaskDateRowHeight(task.title, taskSummary);

                return (
                  <div
                    key={task.id}
                    className="flex"
                    style={{ minHeight: rowHeight }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedTaskId = event.dataTransfer.getData('text/plain');
                      if (draggedTaskId && draggedTaskId !== task.id) {
                        onTaskReorder(draggedTaskId, task.id);
                      }
                    }}
                  >
                    <div
                      className="shrink-0 border-r border-cyan-100 bg-slate-50 px-3 py-2"
                      style={{ width: LANE_WIDTH, minHeight: rowHeight }}
                    >
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', task.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        className="mb-2 inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 transition hover:bg-cyan-50"
                        title="Drag to reorder task rows"
                      >
                        <GripHorizontal className="h-3.5 w-3.5" />
                        Move row
                      </button>
                      <div className="whitespace-normal break-words text-sm font-semibold leading-5 text-slate-900">
                        {task.title}
                      </div>
                      <div className="mt-1 inline-flex max-w-full rounded-md border border-cyan-100 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-cyan-800">
                        <span className="break-all">{getTaskBoardLabel(task)}</span>
                      </div>
                      <div className="mt-1 whitespace-normal break-words text-xs leading-4 text-slate-500">
                        {taskSummary}
                      </div>
                    </div>
                    <div className="relative shrink-0" style={{ width: timelineWidth, minHeight: rowHeight }}>
                      <div
                        className="absolute inset-0 grid"
                        style={{ gridTemplateColumns: `repeat(${dates.length}, ${DAY_WIDTH}px)` }}
                      >
                        {dates.map((date) => (
                          <div
                            key={date}
                            className={`border-r border-cyan-100 ${
                              isPlanWorkingDay(date, nonWorkingDates)
                                ? ''
                                : nonWorkingDates.includes(date)
                                  ? 'bg-rose-50/90'
                                  : 'bg-amber-50/80'
                            }`}
                          />
                        ))}
                      </div>

                      {taskBar && (() => {
                        const firstPersonId = taskBar.personIds[0];
                        const color = firstPersonId ? colorsByPersonId[firstPersonId] : undefined;
                        const warning = task.assignments
                          .map((assignment) => getAssignmentTimingWarning(task, assignment))
                          .find(Boolean);
                        return (
                          <div
                            key={`${task.id}-task-date-bar`}
                            onPointerDown={(event) =>
                              onTaskPointerDown(
                                event,
                                UNASSIGNED_LANE_ID,
                                task,
                                ALL_TASK_ASSIGNMENTS_ID,
                                'move'
                              )
                            }
                            className={`absolute flex cursor-grab items-center overflow-hidden rounded-md border text-xs font-semibold shadow-sm active:cursor-grabbing ${
                              warning ? 'ring-2 ring-amber-400' : ''
                            }`}
                            style={{
                              left: taskBar.left,
                              top: 18,
                              width: taskBar.width,
                              height: 34,
                              backgroundColor: color?.fill ?? '#fef3c7',
                              borderColor: color?.border ?? '#f59e0b',
                              color: color?.text ?? '#78350f',
                            }}
                            title={`${taskBar.peopleLabel}, ${taskBar.hours}h, ${getTaskBoardLabel(task)}, ${taskBar.startDate} - ${taskBar.endDate}${warning ? `. ${warning}` : ''}`}
                          >
                            <GripHorizontal className="ml-1 mr-1 h-3.5 w-3.5 shrink-0 opacity-60" />
                            <div className="min-w-0 flex-1 truncate px-1">
                              <span className="font-bold">{taskBar.peopleLabel}</span>
                              <span className="ml-1 opacity-80">{taskBar.hours}h</span>
                              <span className="ml-1 opacity-70">{getTaskBoardLabel(task)}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function getTaskDateBar(
  task: GanttBuilderTask,
  peopleById: Map<string, GanttBuilderPerson>,
  nonWorkingDates: string[],
  dateIndexByDate: Map<string, number>
) {
  const entries = getTaskScheduleEntries(task, peopleById, nonWorkingDates);
  if (entries.length === 0) return null;

  const scheduledDates = Array.from(new Set(entries.map((entry) => entry.date))).sort();
  const startDate = scheduledDates[0];
  const endDate = scheduledDates[scheduledDates.length - 1];
  const startIndex = dateIndexByDate.get(startDate) ?? 0;
  const endIndex = dateIndexByDate.get(endDate) ?? startIndex;
  const peopleNames = Array.from(new Set(entries.map((entry) => entry.personName))).sort();
  const personIds = Array.from(
    new Set(entries.map((entry) => entry.personId).filter((id): id is string => Boolean(id)))
  );

  return {
    startDate,
    endDate,
    left: startIndex * DAY_WIDTH + 4,
    width: Math.max(DAY_WIDTH - 8, (endIndex - startIndex + 1) * DAY_WIDTH - 8),
    hours: roundHours(entries.reduce((sum, entry) => sum + entry.hours, 0)),
    personIds,
    peopleLabel:
      peopleNames.length <= 2
        ? peopleNames.join(', ')
        : `${peopleNames.slice(0, 2).join(', ')} +${peopleNames.length - 2}`,
  };
}

function getTaskDateRowHeight(title: string, summary: string) {
  const titleLines = Math.ceil(Math.max(1, title.length) / 30);
  const summaryLines = Math.ceil(Math.max(1, summary.length) / 42);
  return Math.max(86, 40 + titleLines * 20 + summaryLines * 16);
}

function getTaskEarliestStartDate(task: GanttBuilderTask) {
  return (
    task.assignments
      .flatMap((assignment) => [
        assignment.startDate,
        ...Object.values(assignment.personStartDates ?? {}),
      ])
      .sort()[0] ?? task.startDate
  );
}

interface PersonWorkloadItem {
  taskId: string;
  assignmentId: string;
  taskTitle: string;
  role: ProjectRole | null;
  hours: number;
  dateRanges: DateRange[];
  firstDate: string;
}

interface DateRange {
  start: string;
  end: string;
}

function WeeklyLoadPanel({
  people,
  tasks,
  peopleById,
  nonWorkingDates,
  loadsByPersonId,
}: {
  people: GanttBuilderPerson[];
  tasks: GanttBuilderTask[];
  peopleById: Map<string, GanttBuilderPerson>;
  nonWorkingDates: string[];
  loadsByPersonId: Record<string, CapacityWeekLoad[]>;
}) {
  const workloadByPersonId = useMemo(
    () => buildPersonWorkloads(tasks, peopleById, nonWorkingDates),
    [nonWorkingDates, peopleById, tasks]
  );

  return (
    <section className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
      <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
            <Users className="h-4 w-4" />
            Weekly capacity
          </div>
          <p className="mt-1 text-xs text-emerald-800/80">
            Per-person workload by task and scheduled working-day ranges.
          </p>
        </div>
      </div>
      </div>

      {people.length === 0 ? (
        <div className="p-8 text-sm text-slate-500">No developers match the current filters.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 p-4 lg:grid-cols-2">
          {people.map((person) => {
            const loads = loadsByPersonId[person.id] || [];
            const hasOverload = loads.some((load) => load.overloaded);
            const workload = workloadByPersonId[person.id] || [];
            const totalScheduledHours = roundHours(
              workload.reduce((sum, item) => sum + item.hours, 0)
            );

            return (
              <div
                key={person.id}
                className={`rounded-xl border px-3 py-3 ${
                  hasOverload ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {person.name}
                      </span>
                      {hasOverload && (
                        <span className="rounded-md border border-rose-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          capacity exceeded
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">{getRoleLabel(person.role)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-semibold text-slate-700">
                      {person.weeklyCapacityHours}h/week
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {totalScheduledHours}h planned
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {workload.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      no scheduled work
                    </div>
                  ) : (
                    workload.map((item) => (
                      <div
                        key={`${item.taskId}-${item.assignmentId}`}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-slate-900">
                              {item.taskTitle}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {getRoleLabel(item.role)}
                            </div>
                          </div>
                          <div className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                            {item.hours}h
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.dateRanges.map((range) => (
                            <span
                              key={`${range.start}-${range.end}`}
                              className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800"
                              title={`${formatShortDate(range.start)} - ${formatShortDate(range.end)}`}
                            >
                              {formatDateRange(range.start, range.end)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function buildPersonWorkloads(
  tasks: GanttBuilderTask[],
  peopleById: Map<string, GanttBuilderPerson>,
  nonWorkingDates: string[]
) {
  const workloads = new Map<
    string,
    Map<string, Omit<PersonWorkloadItem, 'dateRanges' | 'firstDate'> & { dates: string[] }>
  >();

  for (const task of tasks) {
    const entries = getTaskScheduleEntries(task, peopleById, nonWorkingDates);

    for (const entry of entries) {
      if (!entry.personId) continue;

      const personWorkloads = workloads.get(entry.personId) ?? new Map();
      const key = `${task.id}:${entry.assignmentId}`;
      const existing = personWorkloads.get(key);

      if (existing) {
        existing.hours = roundHours(existing.hours + entry.hours);
        existing.dates.push(entry.date);
      } else {
        personWorkloads.set(key, {
          taskId: task.id,
          assignmentId: entry.assignmentId,
          taskTitle: task.title,
          role: entry.role,
          hours: entry.hours,
          dates: [entry.date],
        });
      }

      workloads.set(entry.personId, personWorkloads);
    }
  }

  return Object.fromEntries(
    Array.from(workloads.entries()).map(([personId, itemMap]) => [
      personId,
      Array.from(itemMap.values())
        .map((item) => {
          const dateRanges = buildScheduledDateRanges(item.dates);
          return {
            taskId: item.taskId,
            assignmentId: item.assignmentId,
            taskTitle: item.taskTitle,
            role: item.role,
            hours: roundHours(item.hours),
            dateRanges,
            firstDate: dateRanges[0]?.start ?? '',
          };
        })
        .sort(
          (left, right) =>
            left.firstDate.localeCompare(right.firstDate) ||
            left.taskTitle.localeCompare(right.taskTitle)
        ),
    ])
  ) as Record<string, PersonWorkloadItem[]>;
}

function buildScheduledDateRanges(dates: string[]): DateRange[] {
  const sortedDates = Array.from(new Set(dates)).sort();
  if (sortedDates.length === 0) return [];

  const ranges: DateRange[] = [];
  let start = sortedDates[0];
  let previous = sortedDates[0];

  for (const date of sortedDates.slice(1)) {
    if (daysBetween(previous, date) === 1) {
      previous = date;
      continue;
    }

    ranges.push({ start, end: previous });
    start = date;
    previous = date;
  }

  ranges.push({ start, end: previous });
  return ranges;
}

function PersonEditor({
  person,
  onChange,
  onDelete,
}: {
  person: GanttBuilderPerson;
  onChange: (patch: Partial<GanttBuilderPerson>) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <FieldLabel label="Developer" className="min-w-0 flex-1">
          <input
            value={person.name}
            onChange={(event) => onChange({ name: event.target.value })}
            disabled={person.source === 'gitlab'}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100 disabled:text-slate-600"
          />
        </FieldLabel>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            title="Delete developer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_92px] gap-2">
        <FieldLabel label="Role">
          <select
            value={person.role ?? ''}
            onChange={(event) =>
              onChange({ role: (event.target.value || null) as ProjectRole | null })
            }
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="">No role</option>
            {PROJECT_ROLE_OPTIONS.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="Capacity">
          <input
            value={person.weeklyCapacityHours}
            onChange={(event) =>
              onChange({
                weeklyCapacityHours: normalizeCapacityHours(Number(event.target.value)),
              })
            }
            inputMode="decimal"
            aria-label="Weekly capacity hours"
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
          />
        </FieldLabel>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">
        {person.source === 'gitlab' ? 'From GitLab report' : 'Manual developer'}
      </div>
    </div>
  );
}

function TaskTableSection({
  tasks,
  people,
  peopleById,
  nonWorkingDates,
  onTaskChange,
  onAssignmentChange,
  onAssignmentAdd,
  onAssignmentDelete,
  onTaskDelete,
}: {
  tasks: GanttBuilderTask[];
  people: GanttBuilderPerson[];
  peopleById: Map<string, GanttBuilderPerson>;
  nonWorkingDates: string[];
  onTaskChange: (taskId: string, patch: Partial<GanttBuilderTask>) => void;
  onAssignmentChange: (
    taskId: string,
    assignmentId: string,
    patch: Partial<GanttBuilderTaskAssignment>
  ) => void;
  onAssignmentAdd: (taskId: string) => void;
  onAssignmentDelete: (taskId: string, assignmentId: string) => void;
  onTaskDelete: (taskId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
      <div className="border-b border-slate-300 bg-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <ListPlus className="h-4 w-4" />
              Task table
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Each task can contain multiple role estimates and multiple people per role.
            </p>
          </div>
          <div className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
            {tasks.length} task(s)
          </div>
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="p-8 text-sm text-slate-500">No tasks match the current filters.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {tasks.map((task) => (
            <TaskEditor
              key={task.id}
              task={task}
              people={people}
              peopleById={peopleById}
              nonWorkingDates={nonWorkingDates}
              onTaskChange={(patch) => onTaskChange(task.id, patch)}
              onAssignmentChange={(assignmentId, patch) =>
                onAssignmentChange(task.id, assignmentId, patch)
              }
              onAssignmentAdd={() => onAssignmentAdd(task.id)}
              onAssignmentDelete={(assignmentId) => onAssignmentDelete(task.id, assignmentId)}
              onDelete={() => onTaskDelete(task.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskEditor({
  task,
  people,
  peopleById,
  nonWorkingDates,
  onTaskChange,
  onAssignmentChange,
  onAssignmentAdd,
  onAssignmentDelete,
  onDelete,
}: {
  task: GanttBuilderTask;
  people: GanttBuilderPerson[];
  peopleById: Map<string, GanttBuilderPerson>;
  nonWorkingDates: string[];
  onTaskChange: (patch: Partial<GanttBuilderTask>) => void;
  onAssignmentChange: (assignmentId: string, patch: Partial<GanttBuilderTaskAssignment>) => void;
  onAssignmentAdd: () => void;
  onAssignmentDelete: (assignmentId: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4 bg-white px-4 py-4 odd:bg-white even:bg-slate-50/60">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(240px,1fr)_120px] lg:items-end">
        <FieldLabel label="Task title">
          <input
            value={task.title}
            onChange={(event) => onTaskChange({ title: event.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-200"
          />
        </FieldLabel>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          title="Delete task"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>

      {task.source === 'gitlab' && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          {task.issueWebUrl ? (
            <a
              href={task.issueWebUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-sky-700 hover:text-sky-900"
            >
              {task.issueProjectPath}#{task.issueIid}
            </a>
          ) : (
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold">
              {task.issueProjectPath}#{task.issueIid}
            </span>
          )}
          <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 font-semibold text-sky-800">
            board: {getTaskBoardLabel(task)}
          </span>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
            GitLab: {task.gitlabState ?? 'unknown'}
          </span>
          {task.gitlabMilestoneTitle && (
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
              {task.gitlabMilestoneTitle}
            </span>
          )}
          {task.gitlabDueDate && (
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
              due {formatShortDate(task.gitlabDueDate)}
            </span>
          )}
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
            spent {task.gitlabSpentHours ?? 0}h / estimate {task.gitlabTimeEstimateHours ?? 0}h
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="hidden grid-cols-[150px_96px_150px_minmax(220px,1fr)_72px] gap-3 border-b border-slate-200 bg-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 lg:grid">
          <div>Role</div>
          <div>Estimate</div>
          <div>Start date</div>
          <div>People</div>
          <div />
        </div>
        <div className="divide-y divide-slate-100">
          {task.assignments.map((assignment) => (
            <AssignmentEditor
              key={assignment.id}
              assignment={assignment}
              people={people}
              peopleById={peopleById}
              nonWorkingDates={nonWorkingDates}
              warning={getAssignmentTimingWarning(task, assignment)}
              canDelete={task.assignments.length > 1}
              onChange={(patch) => onAssignmentChange(assignment.id, patch)}
              onDelete={() => onAssignmentDelete(assignment.id)}
            />
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            Total estimate: {getTaskTotalEstimateHours(task)}h
          </div>
          <button
            type="button"
            onClick={onAssignmentAdd}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add role estimate
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignmentEditor({
  assignment,
  people,
  peopleById,
  nonWorkingDates,
  warning,
  canDelete,
  onChange,
  onDelete,
}: {
  assignment: GanttBuilderTaskAssignment;
  people: GanttBuilderPerson[];
  peopleById: Map<string, GanttBuilderPerson>;
  nonWorkingDates: string[];
  warning: string | null;
  canDelete: boolean;
  onChange: (patch: Partial<GanttBuilderTaskAssignment>) => void;
  onDelete: () => void;
}) {
  const [estimateDraft, setEstimateDraft] = useState(String(assignment.estimateHours));

  useEffect(() => {
    setEstimateDraft(String(assignment.estimateHours));
  }, [assignment.estimateHours]);

  const commitEstimate = () => {
    const trimmed = estimateDraft.trim();
    if (!trimmed) {
      setEstimateDraft(String(assignment.estimateHours));
      return;
    }
    const parsed = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) {
      const normalized = Math.max(0.25, normalizeEstimateHours(parsed));
      onChange({ estimateHours: normalized });
      setEstimateDraft(String(normalized));
      return;
    }
    setEstimateDraft(String(assignment.estimateHours));
  };

  return (
    <div
      className={`grid grid-cols-1 gap-3 px-3 py-3 lg:grid-cols-[150px_96px_150px_minmax(220px,1fr)_72px] lg:items-start ${
        warning ? 'bg-amber-50/80' : ''
      }`}
    >
      <FieldLabel label="Role" compactOnDesktop>
        <RoleSelect value={assignment.role} onChange={(role) => onChange({ role })} />
      </FieldLabel>
      <FieldLabel label="Estimate" compactOnDesktop>
        <input
          value={estimateDraft}
          onChange={(event) => setEstimateDraft(event.target.value)}
          onBlur={commitEstimate}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          inputMode="decimal"
          aria-label="Role estimate hours"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-200"
        />
      </FieldLabel>
      <FieldLabel label="Start date" compactOnDesktop>
        <input
          type="date"
          value={assignment.startDate}
          onChange={(event) =>
            onChange({
              startDate: event.target.value
                ? nextWorkingDate(event.target.value, nonWorkingDates)
                : assignment.startDate,
            })
          }
          className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 ${
            warning
              ? 'border-amber-300 bg-white focus:ring-amber-200'
              : 'border-slate-200 focus:ring-sky-200'
          }`}
        />
      </FieldLabel>
      <FieldLabel label="People" compactOnDesktop>
        <PeopleCheckboxList
          people={people}
          selectedIds={assignment.assigneeIds}
          onChange={(assigneeIds) => onChange({ assigneeIds })}
        />
        {assignment.assigneeIds.length > 0 && (
          <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            {assignment.assigneeIds.map((personId) => {
              const person = peopleById.get(personId);

              return (
                <div
                  key={personId}
                  className="grid grid-cols-[minmax(0,1fr)_88px_148px] items-center gap-2"
                >
                  <span className="truncate text-[11px] font-medium text-slate-700">
                    {person?.name ?? 'Unknown'}
                  </span>
                  <PersonEstimateInput
                    value={assignment.personEstimates?.[personId] ?? assignment.estimateHours}
                    ariaLabel={`Estimate hours for ${person?.name ?? 'Unknown'}`}
                    onCommit={(hours) =>
                      onChange({
                        personEstimates: {
                          ...(assignment.personEstimates ?? {}),
                          [personId]: normalizeEstimateHours(hours),
                        },
                      })
                    }
                  />
                  <input
                    type="date"
                    value={assignment.personStartDates?.[personId] ?? assignment.startDate}
                    onChange={(event) =>
                      onChange({
                        personStartDates: {
                          ...(assignment.personStartDates ?? {}),
                          [personId]: event.target.value
                            ? nextWorkingDate(event.target.value, nonWorkingDates)
                            : assignment.startDate,
                        },
                      })
                    }
                    aria-label={`Start date for ${person?.name ?? 'Unknown'}`}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-1 text-[11px] text-slate-500">
          {formatAssignmentPeopleSummary(assignment, peopleById)}
        </div>
        {warning && <div className="mt-1 text-[11px] font-semibold text-amber-700">{warning}</div>}
      </FieldLabel>
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        className="inline-flex h-9 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 lg:w-full"
        title="Delete role estimate"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: ProjectRole | null;
  onChange: (value: ProjectRole | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(event) => onChange((event.target.value || null) as ProjectRole | null)}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
    >
      <option value="">No role</option>
      {PROJECT_ROLE_OPTIONS.map((role) => (
        <option key={role.id} value={role.id}>
          {role.label}
        </option>
      ))}
    </select>
  );
}

function PersonEstimateInput({
  value,
  ariaLabel,
  onCommit,
}: {
  value: number;
  ariaLabel: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(String(value));
      return;
    }
    const parsed = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) {
      const normalized = Math.max(0.25, Math.round(parsed * 4) / 4);
      onCommit(normalized);
      setDraft(String(normalized));
      return;
    }
    setDraft(String(value));
  };

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      inputMode="decimal"
      aria-label={ariaLabel}
      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-sky-200"
    />
  );
}

function PeopleCheckboxList({
  people,
  selectedIds,
  onChange,
}: {
  people: GanttBuilderPerson[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}) {
  const selected = new Set(selectedIds);

  const toggle = (personId: string) => {
    if (selected.has(personId)) {
      onChange(selectedIds.filter((candidate) => candidate !== personId));
      return;
    }
    onChange([...selectedIds, personId]);
  };

  if (people.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        No people yet. Add a developer first.
      </div>
    );
  }

  return (
    <div className="max-h-28 overflow-auto rounded-lg border border-slate-200 bg-white p-2">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {people.map((person) => (
          <label
            key={person.id}
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={selected.has(person.id)}
              onChange={() => toggle(person.id)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-sky-700 focus:ring-sky-200"
            />
            <span className="truncate">{person.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  children,
  className = '',
  compactOnDesktop = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  compactOnDesktop?: boolean;
}) {
  return (
    <label className={`block ${className}`}>
      <span
        className={`mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 ${
          compactOnDesktop ? 'lg:hidden' : ''
        }`}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  const toneClasses: Record<typeof tone, string> = {
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
  };

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClasses[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70">
          {icon}
        </div>
      </div>
    </div>
  );
}

function updatePlanTask(
  plan: GanttBuilderPlan,
  taskId: string,
  patch: Partial<GanttBuilderTask>
): GanttBuilderPlan {
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

function reorderPlanTasks(
  plan: GanttBuilderPlan,
  draggedTaskId: string,
  targetTaskId: string
): GanttBuilderPlan {
  if (draggedTaskId === targetTaskId) return plan;

  const orderedTasks = [...plan.tasks].sort(sortTasksByPlanOrder);
  const fromIndex = orderedTasks.findIndex((task) => task.id === draggedTaskId);
  const toIndex = orderedTasks.findIndex((task) => task.id === targetTaskId);
  if (fromIndex < 0 || toIndex < 0) return plan;

  const [draggedTask] = orderedTasks.splice(fromIndex, 1);
  orderedTasks.splice(toIndex, 0, draggedTask);
  const orderByTaskId = new Map(
    orderedTasks.map((task, index) => [task.id, index + 1])
  );

  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({
      ...task,
      order: orderByTaskId.get(task.id) ?? task.order,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function updateTaskAssignment(
  plan: GanttBuilderPlan,
  taskId: string,
  assignmentId: string,
  patch: Partial<GanttBuilderTaskAssignment>
): GanttBuilderPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            assignments: task.assignments.map((assignment) =>
              assignment.id === assignmentId
                ? {
                    ...assignment,
                    ...patch,
                    estimateHours:
                      patch.estimateHours !== undefined
                        ? normalizeEstimateHours(patch.estimateHours)
                        : assignment.estimateHours,
                    assigneeIds:
                      patch.assigneeIds !== undefined
                        ? Array.from(new Set(patch.assigneeIds))
                        : assignment.assigneeIds,
                    personEstimates: syncAssignmentPersonEstimates(
                      patch.assigneeIds !== undefined
                        ? Array.from(new Set(patch.assigneeIds))
                        : assignment.assigneeIds,
                      patch.estimateHours !== undefined
                        ? normalizeEstimateHours(patch.estimateHours)
                        : assignment.estimateHours,
                      patch.personEstimates ?? assignment.personEstimates
                    ),
                    personStartDates: syncAssignmentPersonStartDates(
                      patch.assigneeIds !== undefined
                        ? Array.from(new Set(patch.assigneeIds))
                        : assignment.assigneeIds,
                      patch.startDate !== undefined ? patch.startDate : assignment.startDate,
                      patch.personStartDates ?? assignment.personStartDates
                    ),
                  }
                : assignment
            ),
          }
        : task
    ),
    updatedAt: new Date().toISOString(),
  };
}

function addTaskAssignment(plan: GanttBuilderPlan, taskId: string): GanttBuilderPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            assignments: [
              ...task.assignments,
              createTaskAssignment({ startDate: task.assignments[0]?.startDate ?? task.startDate }),
            ],
          }
        : task
    ),
    updatedAt: new Date().toISOString(),
  };
}

function deleteTaskAssignment(
  plan: GanttBuilderPlan,
  taskId: string,
  assignmentId: string
): GanttBuilderPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            assignments:
              task.assignments.length > 1
                ? task.assignments.filter((assignment) => assignment.id !== assignmentId)
                : task.assignments,
          }
        : task
    ),
    updatedAt: new Date().toISOString(),
  };
}

function updateTaskLaneEstimate(
  plan: GanttBuilderPlan,
  taskId: string,
  assignmentId: string,
  laneId: string,
  laneEstimateHours: number
): GanttBuilderPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => {
      if (task.id !== taskId) return task;

      return {
        ...task,
        assignments: task.assignments.map((assignment) =>
          assignment.id === assignmentId
            ? {
                ...assignment,
                estimateHours:
                  laneId === UNASSIGNED_LANE_ID
                    ? normalizeEstimateHours(laneEstimateHours)
                    : assignment.estimateHours,
              personEstimates:
                laneId === UNASSIGNED_LANE_ID
                  ? assignment.personEstimates
                  : {
                      ...assignment.personEstimates,
                      [laneId]: normalizeEstimateHours(laneEstimateHours),
                    },
                personStartDates: assignment.personStartDates,
              }
            : assignment
        ),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

function updateTaskLaneAssignee(
  plan: GanttBuilderPlan,
  taskId: string,
  assignmentId: string,
  fromLaneId: string,
  toLaneId: string,
  startDate: string
): GanttBuilderPlan {
  const fromPersonId = fromLaneId === UNASSIGNED_LANE_ID ? null : fromLaneId;
  const toPersonId = toLaneId === UNASSIGNED_LANE_ID ? null : toLaneId;
  const toPerson = toPersonId ? plan.people.find((person) => person.id === toPersonId) : null;

  return {
    ...plan,
    tasks: plan.tasks.map((task) => {
      if (task.id !== taskId) return task;

      return {
        ...task,
        assignments: task.assignments.map((assignment) => {
          if (assignment.id !== assignmentId) return assignment;

          const baseAssignment = {
            ...assignment,
            startDate,
          };

          if (fromLaneId === toLaneId) {
            if (fromPersonId === null) {
              return baseAssignment;
            }

            return {
              ...assignment,
              personStartDates: syncAssignmentPersonStartDates(
                assignment.assigneeIds,
                assignment.startDate,
                {
                  ...(assignment.personStartDates ?? {}),
                  [fromPersonId]: startDate,
                }
              ),
            };
          }

          if (fromPersonId === null && assignment.assigneeIds.length === 0) {
            return {
              ...baseAssignment,
              role: baseAssignment.role ?? toPerson?.role ?? null,
              assigneeIds: toPersonId ? [toPersonId] : [],
              personEstimates: toPersonId
                ? {
                    [toPersonId]: assignment.estimateHours,
                  }
                : undefined,
              personStartDates: toPersonId
                ? {
                    [toPersonId]: startDate,
                  }
                : undefined,
            };
          }

          if (fromPersonId && assignment.assigneeIds.includes(fromPersonId)) {
            const nextIds = assignment.assigneeIds
              .map((personId) => (personId === fromPersonId ? toPersonId : personId))
              .filter((personId): personId is string => Boolean(personId));
            const movedEstimate =
              assignment.personEstimates?.[fromPersonId] ?? assignment.estimateHours;
            const nextPersonEstimates = { ...(assignment.personEstimates ?? {}) };
            const nextPersonStartDates = { ...(assignment.personStartDates ?? {}) };
            delete nextPersonEstimates[fromPersonId];
            delete nextPersonStartDates[fromPersonId];
            if (toPersonId) {
              nextPersonEstimates[toPersonId] = movedEstimate;
              nextPersonStartDates[toPersonId] = startDate;
            }
            return {
              ...baseAssignment,
              role: baseAssignment.role ?? toPerson?.role ?? null,
              assigneeIds: Array.from(new Set(nextIds)),
              personEstimates:
                nextIds.length > 0
                  ? syncAssignmentPersonEstimates(
                      Array.from(new Set(nextIds)),
                      assignment.estimateHours,
                      nextPersonEstimates
                    )
                  : undefined,
              personStartDates:
                nextIds.length > 0
                  ? syncAssignmentPersonStartDates(
                      Array.from(new Set(nextIds)),
                      assignment.startDate,
                      nextPersonStartDates
                    )
                  : undefined,
            };
          }

          return baseAssignment;
        }),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

function updateTaskAllAssignmentStartDates(
  plan: GanttBuilderPlan,
  taskId: string,
  nextTaskStartDate: string
): GanttBuilderPlan {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return plan;

  const earliestStartDate = task.assignments
    .flatMap((assignment) => [
      assignment.startDate,
      ...Object.values(assignment.personStartDates ?? {}),
    ])
    .sort()[0];
  if (!earliestStartDate) return plan;

  const deltaDays = daysBetween(earliestStartDate, nextTaskStartDate);

  return {
    ...plan,
    tasks: plan.tasks.map((candidate) => {
      if (candidate.id !== taskId) return candidate;

      return {
        ...candidate,
        startDate: nextWorkingDate(addDays(candidate.startDate, deltaDays), plan.nonWorkingDates),
        assignments: candidate.assignments.map((assignment) => ({
          ...assignment,
          startDate: nextWorkingDate(addDays(assignment.startDate, deltaDays), plan.nonWorkingDates),
          personStartDates: assignment.personStartDates
            ? Object.fromEntries(
                Object.entries(assignment.personStartDates).map(([personId, startDate]) => [
                  personId,
                  nextWorkingDate(addDays(startDate, deltaDays), plan.nonWorkingDates),
                ])
              )
            : undefined,
        })),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

function updatePlanPerson(
  plan: GanttBuilderPlan,
  personId: string,
  patch: Partial<GanttBuilderPerson>
): GanttBuilderPlan {
  return {
    ...plan,
    people: plan.people.map((person) =>
      person.id === personId
        ? {
            ...person,
            ...patch,
            weeklyCapacityHours:
              patch.weeklyCapacityHours !== undefined
                ? normalizeCapacityHours(patch.weeklyCapacityHours)
                : person.weeklyCapacityHours,
          }
        : person
    ),
    updatedAt: new Date().toISOString(),
  };
}

function deleteTask(plan: GanttBuilderPlan, taskId: string): GanttBuilderPlan {
  return {
    ...plan,
    tasks: plan.tasks.filter((task) => task.id !== taskId),
    updatedAt: new Date().toISOString(),
  };
}

function deletePerson(plan: GanttBuilderPlan, personId: string): GanttBuilderPlan {
  return {
    ...plan,
    people: plan.people.filter((person) => person.id !== personId),
    tasks: plan.tasks.map((task) => ({
      ...task,
      assignments: task.assignments.map((assignment) => ({
        ...assignment,
        assigneeIds: assignment.assigneeIds.filter((assigneeId) => assigneeId !== personId),
        personEstimates: syncAssignmentPersonEstimates(
          assignment.assigneeIds.filter((assigneeId) => assigneeId !== personId),
          assignment.estimateHours,
          assignment.personEstimates
        ),
        personStartDates: syncAssignmentPersonStartDates(
          assignment.assigneeIds.filter((assigneeId) => assigneeId !== personId),
          assignment.startDate,
          assignment.personStartDates
        ),
      })),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function syncAssignmentPersonEstimates(
  assigneeIds: string[],
  fallbackEstimateHours: number,
  personEstimates?: Record<string, number>
) {
  if (assigneeIds.length === 0) return undefined;

  return Object.fromEntries(
    assigneeIds.map((personId) => [
      personId,
      normalizeEstimateHours(personEstimates?.[personId] ?? fallbackEstimateHours),
    ])
  );
}

function syncAssignmentPersonStartDates(
  assigneeIds: string[],
  fallbackStartDate: string,
  personStartDates?: Record<string, string>
) {
  if (assigneeIds.length === 0) return undefined;

  return Object.fromEntries(
    assigneeIds.map((personId) => [
      personId,
      personStartDates?.[personId] ?? fallbackStartDate,
    ])
  );
}

function getLaneIdAtPointer(
  clientY: number,
  rowsElement: HTMLDivElement | null
) {
  if (!rowsElement) return null;
  const laneElements = Array.from(
    rowsElement.querySelectorAll<HTMLElement>('[data-lane-id]')
  );
  const target = laneElements.find((element) => {
    const rect = element.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom;
  });

  return target?.dataset.laneId ?? null;
}

function taskMatchesFilters(
  task: GanttBuilderTask,
  {
    personFilter,
    roleFilter,
    visibleLaneIds,
  }: {
    personFilter: string;
    roleFilter: RoleFilter;
    visibleLaneIds: Set<string>;
  }
) {
  const matchesPerson =
    personFilter === 'all'
      ? task.assignments.some((assignment) =>
          assignment.assigneeIds.length > 0
            ? assignment.assigneeIds.some((personId) => visibleLaneIds.has(personId))
            : visibleLaneIds.has(UNASSIGNED_LANE_ID)
        )
      : personFilter === 'unassigned'
        ? task.assignments.some((assignment) => assignment.assigneeIds.length === 0)
        : task.assignments.some((assignment) => assignment.assigneeIds.includes(personFilter));

  if (!matchesPerson) return false;

  if (roleFilter === 'all') return true;
  if (roleFilter === 'none') {
    return task.assignments.some((assignment) => !assignment.role);
  }
  return task.assignments.some((assignment) => assignment.role === roleFilter);
}

function sortTasksByPlanOrder(left: GanttBuilderTask, right: GanttBuilderTask) {
  return (
    (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
    left.title.localeCompare(right.title)
  );
}

interface PlanWarning {
  id: string;
  message: string;
}

function buildPlanWarnings(plan: GanttBuilderPlan, context: ReturnType<typeof createGanttBuilderContext>): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const peopleById = new Map(plan.people.map((person) => [person.id, person]));

  for (const task of plan.tasks) {
    if (task.source !== 'gitlab') continue;

    const taskEndDate = getTaskEndDate(task, plan.people, plan.nonWorkingDates);
    const plannedAssignees = new Set(task.assignments.flatMap((assignment) => assignment.assigneeIds));
    const gitlabAssignees = new Set(task.gitlabAssigneeIds ?? []);
    const taskRef = `${task.issueProjectPath ?? 'GitLab'}#${task.issueIid ?? task.id}`;

    if (task.gitlabState === 'closed' && taskEndDate > today) {
      warnings.push({
        id: `${task.id}:closed-future`,
        message: `${taskRef} is closed in GitLab but planned into the future.`,
      });
    }

    if (task.gitlabState !== 'closed' && taskEndDate < today) {
      warnings.push({
        id: `${task.id}:open-past`,
        message: `${taskRef} is still open in GitLab but the local plan ends before today.`,
      });
    }

    if (!setsEqual(plannedAssignees, gitlabAssignees)) {
      const plannedNames = Array.from(plannedAssignees)
        .map((personId) => peopleById.get(personId)?.name)
        .filter(Boolean)
        .join(', ') || 'unassigned';
      const gitlabNames = task.gitlabAssigneeNames?.join(', ') || 'unassigned';
      warnings.push({
        id: `${task.id}:assignees`,
        message: `${taskRef} local assignees (${plannedNames}) differ from GitLab (${gitlabNames}).`,
      });
    }

    if (task.gitlabTimeEstimateHours === 0) {
      warnings.push({
        id: `${task.id}:no-estimate`,
        message: `${taskRef} has no GitLab time estimate.`,
      });
    }

    if (
      task.gitlabTimeEstimateHours !== undefined &&
      task.gitlabSpentHours !== undefined &&
      task.gitlabTimeEstimateHours > 0 &&
      task.gitlabSpentHours > task.gitlabTimeEstimateHours
    ) {
      warnings.push({
        id: `${task.id}:spent-over-estimate`,
        message: `${taskRef} spent time is already above GitLab estimate.`,
      });
    }

    if (task.startDate < context.period.start || taskEndDate > context.period.end) {
      warnings.push({
        id: `${task.id}:outside-period`,
        message: `${taskRef} is planned outside the selected Gantt period.`,
      });
    }
  }

  return warnings;
}

function countChangedTasks(savedPlanJson: string, plan: GanttBuilderPlan) {
  try {
    const saved = JSON.parse(savedPlanJson) as Partial<GanttBuilderPlan>;
    const savedTasksById = new Map((saved.tasks ?? []).map((task) => [task.id, JSON.stringify(task)]));
    return plan.tasks.filter((task) => savedTasksById.get(task.id) !== JSON.stringify(task)).length;
  } catch {
    return plan.tasks.length;
  }
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

function getStrategyLabel(strategy: GitLabGanttIssueStrategy) {
  if (strategy === 'milestone') return 'Milestone only';
  return 'Opened + recently closed';
}

function setsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function taskHasLaneWork(task: GanttBuilderTask, personId: string | null) {
  return getTaskLaneHours(task, personId) > 0;
}

function formatTaskAssignmentsSummary(
  task: GanttBuilderTask,
  peopleById: Map<string, GanttBuilderPerson>
) {
  const parts = task.assignments.map((assignment) => {
    const totalHours =
      assignment.assigneeIds.length > 0
        ? roundHours(
            assignment.assigneeIds.reduce(
              (sum, personId) => sum + getAssignmentPersonHours(assignment, personId),
              0
            )
          )
        : assignment.estimateHours;
    const people =
      assignment.assigneeIds.length > 0
        ? assignment.assigneeIds
            .map((personId) => peopleById.get(personId)?.name)
            .filter(Boolean)
            .join(', ')
        : 'Unassigned';
    return `${getRoleLabel(assignment.role)} ${totalHours}h: ${people}`;
  });

  return parts.join(' | ');
}

function getTaskBoardLabel(task: GanttBuilderTask) {
  return task.issueProjectPath ?? 'local/manual';
}

function formatAssignmentPeopleSummary(
  assignment: GanttBuilderTaskAssignment,
  peopleById: Map<string, GanttBuilderPerson>
) {
  if (assignment.assigneeIds.length === 0) {
    return 'Unassigned role estimate';
  }

  const perPersonHours = assignment.assigneeIds.map((personId) => {
    const person = peopleById.get(personId);
    return `${person?.name ?? 'Unknown'} ${getAssignmentPersonHours(assignment, personId)}h`;
  });

  return perPersonHours.join(', ');
}

function getAssignmentTimingWarning(
  task: GanttBuilderTask,
  assignment: GanttBuilderTaskAssignment
) {
  const earliestPmStart = task.assignments
    .filter((candidate) => candidate.role && PM_ROLES.has(candidate.role))
    .map((candidate) => candidate.startDate)
    .sort()[0];

  if (!earliestPmStart) return null;
  if (!assignment.role || PM_ROLES.has(assignment.role)) return null;
  if (assignment.assigneeIds.length === 0) return null;
  if (assignment.startDate >= earliestPmStart) return null;

  return `Starts before PM work (${formatShortDate(earliestPmStart)})`;
}

function getLaneItemCalendarBarHeight(
  item: { task: GanttBuilderTask; assignment: GanttBuilderTaskAssignment },
  lanePersonId: string | null,
  peopleById: Map<string, GanttBuilderPerson>,
  nonWorkingDates: string[],
  dateIndexByDate: Map<string, number>
) {
  const scheduledEntries = getTaskScheduleEntries(item.task, peopleById, nonWorkingDates).filter(
    (entry) => entry.assignmentId === item.assignment.id && entry.personId === lanePersonId
  );
  const scheduledDates = Array.from(new Set(scheduledEntries.map((entry) => entry.date))).sort();
  const firstScheduledDate = scheduledDates[0] ?? item.assignment.startDate;
  const startIndex = dateIndexByDate.get(firstScheduledDate) ?? 0;
  const endDate = scheduledDates[scheduledDates.length - 1] ?? firstScheduledDate;
  const endIndex = dateIndexByDate.get(endDate) ?? startIndex;
  const durationDays = endIndex - startIndex + 1;
  const width = Math.max(DAY_WIDTH - 8, durationDays * DAY_WIDTH - 8);
  const title = durationDays > 1 ? item.task.title.trim() : formatCalendarBarTitle(item.task.title);

  return getCalendarBarHeight(title, width, durationDays);
}

function getWorkDaysForLaneHours(hours: number, person?: GanttBuilderPerson) {
  return Math.max(1, Math.ceil(hours / getDailyCapacityHours(person)));
}

function getCalendarBarHeight(title: string, width: number, durationDays: number) {
  if (durationDays <= 1) return BAR_HEIGHT;

  const averageCharacterWidth = 4.8;
  const textWidth = Math.max(28, width - 18);
  const charactersPerLine = Math.max(8, Math.floor(textWidth / averageCharacterWidth));
  const titleLines = Math.max(1, Math.ceil(title.length / charactersPerLine));

  return Math.max(BAR_HEIGHT, 24 + titleLines * 12);
}

function formatCalendarBarTitle(title: string) {
  const trimmed = title.trim();
  if (trimmed.length <= BAR_TITLE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, BAR_TITLE_MAX_LENGTH)}...`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

function formatWeekday(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

function formatDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) return formatShortDate(startDate);
  if (startDate.slice(0, 7) === endDate.slice(0, 7)) {
    return `${formatMonth(startDate)} ${formatDay(startDate)}-${formatDay(endDate)}`;
  }

  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatMonth(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function addDays(date: string, days: number) {
  const timestamp = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(timestamp + days * 86400000).toISOString().slice(0, 10);
}

function buildPersonColor(index: number): PersonColor {
  const hue = (index * 47) % 360;
  return {
    fill: `hsl(${hue} 85% 90%)`,
    strong: `hsl(${hue} 72% 38%)`,
    border: `hsl(${hue} 75% 72%)`,
    text: `hsl(${hue} 58% 22%)`,
  };
}

