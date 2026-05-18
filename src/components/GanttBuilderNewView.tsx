import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CalendarRange,
  CheckSquare,
  Copy,
  GitBranch,
  GripHorizontal,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Redo2,
  Save,
  Table2,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { ReportResult } from '../types';
import {
  buildCapacityWeekLoads,
  buildGanttBuilderCalendarDates,
  createTask,
  createTaskAssignment,
  createGitLabGanttBuilderPlan,
  DEFAULT_TASK_ESTIMATE_HOURS,
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
import { isEditableTarget, usePlanHistory } from '../lib/usePlanHistory';

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
type RowDropPosition = 'before' | 'after';

interface TimelineDragState {
  taskId: string;
  taskIds: string[];
  mode: TimelineInteractionMode;
  originClientX: number;
  dragStepWidth: number;
  originStartDate: string;
  originStartDatesByTaskId: Record<string, string>;
  originEstimateHours: number;
  dailyCapacityHours: number;
}

const DEFAULT_TASK_GRID_WIDTH = 900;
const MIN_TASK_GRID_WIDTH = 640;
const MAX_TASK_GRID_WIDTH = 1180;
const TASK_GRID_TEMPLATE =
  '28px 34px minmax(140px,1fr) minmax(92px,0.55fr) 64px minmax(110px,0.75fr) minmax(96px,0.65fr) 68px';
const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 52;
const MIN_TASK_ESTIMATE_HOURS = 0.25;
const TIMELINE_RUNWAY_WIDTH = 720;

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
  const documentHistory = usePlanHistory<GanttBuilderNewDocument | null>(
    loadGanttBuilderNewDocument(context)
  );
  const document = documentHistory.state;
  const setDocument = documentHistory.setState;
  const resetDocumentHistory = documentHistory.resetHistory;
  const undoDocument = documentHistory.undo;
  const redoDocument = documentHistory.redo;
  const [savedPlanJson, setSavedPlanJson] = useState(() => JSON.stringify(document));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedTaskId, setLastSelectedTaskId] = useState<string | null>(null);
  const [bulkShiftDays, setBulkShiftDays] = useState(1);
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkEstimateDelta, setBulkEstimateDelta] = useState(1);
  const [clipboardTasks, setClipboardTasks] = useState<GanttBuilderTask[]>([]);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [plannerFullscreen, setPlannerFullscreen] = useState(false);
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
    resetDocumentHistory(nextDocument);
    setSavedPlanJson(JSON.stringify(nextDocument));
    setSelectedTaskId(null);
    setInspectedTaskId(null);
    setSelectedTaskIds(new Set());
    setLastSelectedTaskId(null);
  }, [context, resetDocumentHistory, storageKey]);

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
  const tasks = useMemo(() => (plan ? sortTasksForDisplay(plan.tasks) : []), [plan]);
  const selectedTaskCount = selectedTaskIds.size;
  const selectedTask = inspectedTaskId
    ? tasks.find((task) => task.id === inspectedTaskId) ?? null
    : null;

  useEffect(() => {
    const taskIds = new Set(tasks.map((task) => task.id));
    setSelectedTaskIds((current) => {
      const next = new Set(Array.from(current).filter((taskId) => taskIds.has(taskId)));
      return areStringSetsEqual(next, current) ? current : next;
    });
    if (selectedTaskId && !taskIds.has(selectedTaskId)) {
      setSelectedTaskId(null);
    }
    if (inspectedTaskId && !taskIds.has(inspectedTaskId)) {
      setInspectedTaskId(null);
    }
  }, [inspectedTaskId, selectedTaskId, tasks]);

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
    [setDocument]
  );

  useEffect(() => {
    if (!dragState) return;

    const previousCursor = window.document.body.style.cursor;
    const previousUserSelect = window.document.body.style.userSelect;
    window.document.body.style.cursor = dragState.mode === 'resize' ? 'ew-resize' : 'grabbing';
    window.document.body.style.userSelect = 'none';

    const onPointerMove = (event: PointerEvent) => {
      const dayDelta = Math.round(
        (event.clientX - dragState.originClientX) / Math.max(1, dragState.dragStepWidth)
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
            : moveTaskSchedulesByDragDelta(current.plan, dragState, dayDelta);

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
  }, [dragState, updateDocument]);

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
    mode: TimelineInteractionMode,
    dragStepWidth: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedTaskId(task.id);

    if (mode === 'move' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      if (event.shiftKey && lastSelectedTaskId) {
        setSelectedTaskIds(selectTaskRange(tasks, lastSelectedTaskId, task.id));
      } else {
        setSelectedTaskIds((current) => toggleTaskSelection(current, task.id));
      }
      setLastSelectedTaskId(task.id);
      return;
    }

    const orderedTaskIds =
      mode === 'move' && selectedTaskIds.has(task.id) && selectedTaskIds.size > 1
        ? tasks.filter((candidate) => selectedTaskIds.has(candidate.id)).map((candidate) => candidate.id)
        : [task.id];
    if (mode === 'move' && orderedTaskIds.length > 1) {
      setSelectedTaskIds(new Set(orderedTaskIds));
    } else {
      setSelectedTaskIds(new Set([task.id]));
    }
    setLastSelectedTaskId(task.id);

    const primaryAssignment = getPrimaryAssignment(task);
    const primaryPersonId = primaryAssignment?.assigneeIds[0] ?? null;
    const primaryPerson = primaryPersonId ? peopleById.get(primaryPersonId) : undefined;

    setDragState({
      taskId: task.id,
      taskIds: orderedTaskIds,
      mode,
      originClientX: event.clientX,
      dragStepWidth,
      originStartDate: getTaskEarliestStartDate(task),
      originStartDatesByTaskId: Object.fromEntries(
        orderedTaskIds.map((taskId) => {
          const candidate = tasks.find((item) => item.id === taskId);
          return [taskId, candidate ? getTaskEarliestStartDate(candidate) : task.startDate];
        })
      ),
      originEstimateHours: primaryAssignment?.estimateHours ?? getTaskTotalEstimateHours(task),
      dailyCapacityHours: getDailyCapacityHours(primaryPerson),
    });
  };

  const handleTaskRowSelect = (taskId: string, event: ReactMouseEvent) => {
    setSelectedTaskId(taskId);
    setInspectedTaskId(taskId);
    setLastSelectedTaskId(taskId);

    if (event.shiftKey && lastSelectedTaskId) {
      setSelectedTaskIds(selectTaskRange(tasks, lastSelectedTaskId, taskId));
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedTaskIds((current) => toggleTaskSelection(current, taskId));
      return;
    }

    setSelectedTaskIds(new Set([taskId]));
  };

  const handleTaskCheckboxChange = (taskId: string, checked: boolean, event: ReactMouseEvent) => {
    event.stopPropagation();
    setSelectedTaskId(taskId);
    setLastSelectedTaskId(taskId);
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const handleSelectAllTasks = () => {
    setSelectedTaskIds(new Set(tasks.map((task) => task.id)));
    setLastSelectedTaskId(tasks[tasks.length - 1]?.id ?? null);
  };

  const handleClearSelection = () => {
    setSelectedTaskIds(new Set());
    setLastSelectedTaskId(null);
  };

  const handleReorderRows = (
    draggedTaskIds: string[],
    targetTaskId: string,
    position: RowDropPosition
  ) => {
    updateDocument((current) => ({
      ...current,
      plan: reorderPlanTasks(current.plan, draggedTaskIds, targetTaskId, position),
    }));
  };

  const handleMoveSelectedRows = useCallback((direction: -1 | 1) => {
    const movingTaskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    if (movingTaskIds.length === 0) return;
    updateDocument((current) => ({
      ...current,
      plan: movePlanTasksByStep(current.plan, movingTaskIds, direction),
    }));
  }, [selectedTaskId, selectedTaskIds, updateDocument]);

  const handleAddTask = (afterTaskId?: string) => {
    updateDocument((current) => {
      const orderedTasks = sortTasksForDisplay(current.plan.tasks);
      const afterTask = afterTaskId
        ? orderedTasks.find((task) => task.id === afterTaskId)
        : orderedTasks[orderedTasks.length - 1];
      const primaryAssignment = afterTask ? getPrimaryAssignment(afterTask) : null;
      const newTask = createTask({
        title: 'New task',
        startDate: primaryAssignment?.startDate ?? afterTask?.startDate ?? context.period.start,
        estimateHours: primaryAssignment?.estimateHours ?? DEFAULT_TASK_ESTIMATE_HOURS,
        assigneeIds: primaryAssignment?.assigneeIds ?? [],
        role: primaryAssignment?.role ?? null,
      });
      const nextPlan = insertPlanTasks(current.plan, [newTask], afterTaskId);
      setSelectedTaskId(newTask.id);
      setInspectedTaskId(newTask.id);
      setSelectedTaskIds(new Set([newTask.id]));
      setLastSelectedTaskId(newTask.id);
      return {
        ...current,
        plan: nextPlan,
      };
    });
  };

  const handleBulkAssigneeChange = (assigneeId: string) => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    updateDocument((current) => {
      const person = current.plan.people.find((candidate) => candidate.id === assigneeId);
      return {
        ...current,
        plan: taskIds.reduce(
          (plan, taskId) =>
            updateTaskPrimaryAssignment(plan, taskId, {
              assigneeIds: assigneeId ? [assigneeId] : [],
              role: person?.role,
            }),
          current.plan
        ),
      };
    });
  };

  const handleBulkRoleChange = (role: ProjectRole | '') => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    updateDocument((current) => ({
      ...current,
      plan: taskIds.reduce(
        (plan, taskId) => updateTaskPrimaryAssignment(plan, taskId, { role: role || null }),
        current.plan
      ),
    }));
  };

  const handleBulkShiftDates = (days: number) => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    if (!Number.isFinite(days) || days === 0) return;
    updateDocument((current) => ({
      ...current,
      plan: taskIds.reduce((plan, taskId) => {
        const task = plan.tasks.find((candidate) => candidate.id === taskId);
        if (!task) return plan;
        return moveTaskSchedule(
          plan,
          taskId,
          resolvePlanWorkingDate(
            addDays(getTaskEarliestStartDate(task), days),
            plan.nonWorkingDates,
            days
          )
        );
      }, current.plan),
    }));
  };

  const handleBulkStartDate = () => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    if (!isIsoDate(bulkStartDate)) return;
    updateDocument((current) => ({
      ...current,
      plan: taskIds.reduce(
        (plan, taskId) => moveTaskSchedule(plan, taskId, bulkStartDate),
        current.plan
      ),
    }));
  };

  const handleBulkEstimateDelta = (deltaHours: number) => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    if (!Number.isFinite(deltaHours) || deltaHours === 0) return;
    updateDocument((current) => ({
      ...current,
      plan: taskIds.reduce((plan, taskId) => {
        const task = plan.tasks.find((candidate) => candidate.id === taskId);
        if (!task) return plan;
        const currentEstimate =
          getPrimaryAssignment(task)?.estimateHours ?? getTaskTotalEstimateHours(task);
        return resizeTaskPrimaryEstimate(
          plan,
          taskId,
          Math.max(MIN_TASK_ESTIMATE_HOURS, currentEstimate + deltaHours)
        );
      }, current.plan),
    }));
  };

  const handleCopyTasks = useCallback(() => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    const copied = tasks.filter((task) => taskIds.includes(task.id));
    if (copied.length === 0) return;
    setClipboardTasks(copied);
    setNotice(`Copied ${copied.length} beta task(s).`);
  }, [selectedTaskId, selectedTaskIds, tasks]);

  const handlePasteTasks = useCallback(() => {
    if (clipboardTasks.length === 0) {
      setNotice('No copied beta tasks to paste.');
      return;
    }
    const afterTaskId = selectedTaskId ?? tasks[tasks.length - 1]?.id;
    const clones = clipboardTasks.map((task) => cloneTask(task, 'copy'));
    updateDocument((current) => ({
      ...current,
      plan: insertPlanTasks(current.plan, clones, afterTaskId),
    }));
    setSelectedTaskIds(new Set(clones.map((task) => task.id)));
    setSelectedTaskId(clones[0]?.id ?? null);
    setInspectedTaskId(clones[0]?.id ?? null);
    setLastSelectedTaskId(clones[clones.length - 1]?.id ?? null);
    setNotice(`Pasted ${clones.length} beta task(s).`);
  }, [clipboardTasks, selectedTaskId, tasks, updateDocument]);

  const handleDuplicateTasks = () => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    const sourceTasks = tasks.filter((task) => taskIds.includes(task.id));
    if (sourceTasks.length === 0) return;
    const clones = sourceTasks.map((task) => cloneTask(task, 'duplicate'));
    updateDocument((current) => ({
      ...current,
      plan: insertPlanTasks(current.plan, clones, sourceTasks[sourceTasks.length - 1]?.id),
    }));
    setSelectedTaskIds(new Set(clones.map((task) => task.id)));
    setSelectedTaskId(clones[0]?.id ?? null);
    setInspectedTaskId(clones[0]?.id ?? null);
    setLastSelectedTaskId(clones[clones.length - 1]?.id ?? null);
  };

  const handleDeleteTasks = useCallback(() => {
    const taskIds = getActiveTaskIds(selectedTaskIds, selectedTaskId);
    if (taskIds.length === 0) return;
    if (!window.confirm(`Delete ${taskIds.length} selected beta task(s)?`)) return;
    updateDocument((current) => ({
      ...current,
      plan: deletePlanTasks(current.plan, taskIds),
    }));
    setSelectedTaskId(null);
    setInspectedTaskId(null);
    setSelectedTaskIds(new Set());
    setLastSelectedTaskId(null);
  }, [selectedTaskId, selectedTaskIds, updateDocument]);

  const handleBulkPasteTasks = () => {
    if (!document || !bulkPasteText.trim()) return;
    const parsedTasks = parseBulkTaskText(bulkPasteText, document.plan.people, context.period.start);
    if (parsedTasks.length === 0) {
      setNotice('Paste text did not contain recognizable task rows.');
      return;
    }
    updateDocument((current) => ({
      ...current,
      plan: insertPlanTasks(current.plan, parsedTasks, selectedTaskId ?? tasks[tasks.length - 1]?.id),
    }));
    setSelectedTaskIds(new Set(parsedTasks.map((task) => task.id)));
    setSelectedTaskId(parsedTasks[0]?.id ?? null);
    setInspectedTaskId(parsedTasks[0]?.id ?? null);
    setLastSelectedTaskId(parsedTasks[parsedTasks.length - 1]?.id ?? null);
    setBulkPasteText('');
    setShowBulkPaste(false);
    setNotice(`Added ${parsedTasks.length} pasted beta task(s).`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && plannerFullscreen) {
        event.preventDefault();
        setPlannerFullscreen(false);
        return;
      }
      if (isEditableTarget(event.target)) return;

      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoDocument();
        return;
      }
      if (
        (modifier && event.key.toLowerCase() === 'y') ||
        (modifier && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
        event.preventDefault();
        redoDocument();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        handleCopyTasks();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        handlePasteTasks();
        return;
      }
      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        handleMoveSelectedRows(-1);
        return;
      }
      if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        handleMoveSelectedRows(1);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        handleDeleteTasks();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    redoDocument,
    handleCopyTasks,
    handleDeleteTasks,
    handleMoveSelectedRows,
    handlePasteTasks,
    plannerFullscreen,
    undoDocument,
  ]);

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
          panel: 'plan',
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
              active={document?.view.zoom === 'hours'}
              label="Hours"
              onClick={() => updateDocument((current) => setZoom(current, 'hours'))}
              disabled={!document}
            />
            <ViewButton
              active={document?.view.zoom === 'day'}
              label="Days"
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
            <button
              type="button"
              onClick={undoDocument}
              disabled={!documentHistory.canUndo}
              title="Undo (Ctrl+Z)"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
            <button
              type="button"
              onClick={redoDocument}
              disabled={!documentHistory.canRedo}
              title="Redo (Ctrl+Y)"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Redo2 className="h-3.5 w-3.5" />
              Redo
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ViewButton
              active={!document || document.view.panel === 'plan'}
              label="Plan"
              onClick={() => updateDocument((current) => setPanel(current, 'plan'))}
              disabled={!document}
            />
            <ViewButton
              active={document?.view.panel === 'workload'}
              label="Workload"
              onClick={() => updateDocument((current) => setPanel(current, 'workload'))}
              disabled={!document}
            />
            <ViewButton
              active={document?.view.panel === 'conflicts'}
              label="Conflicts"
              onClick={() => updateDocument((current) => setPanel(current, 'conflicts'))}
              disabled={!document}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{tasks.length} task(s)</span>
            <span>{plan?.people.length ?? 0} people</span>
            <span>{conflicts.length} conflict(s)</span>
            <span>{selectedTaskCount} selected</span>
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
            {document.view.panel === 'plan' && (
              <div
                className={
                  plannerFullscreen
                    ? 'fixed inset-0 z-50 flex flex-col bg-white'
                    : ''
                }
              >
                <BulkTaskToolbar
                  activeTaskCount={getActiveTaskIds(selectedTaskIds, selectedTaskId).length}
                  bulkEstimateDelta={bulkEstimateDelta}
                  bulkShiftDays={bulkShiftDays}
                  bulkStartDate={bulkStartDate}
                  clipboardTaskCount={clipboardTasks.length}
                  people={document.plan.people}
                  plannerFullscreen={plannerFullscreen}
                  selectedTaskCount={selectedTaskCount}
                  showBulkEdit={showBulkEdit}
                  showBulkPaste={showBulkPaste}
                  bulkPasteText={bulkPasteText}
                  onAddTask={() => handleAddTask(selectedTaskId ?? undefined)}
                  onBulkAssigneeChange={handleBulkAssigneeChange}
                  onBulkEstimateDelta={handleBulkEstimateDelta}
                  onBulkEstimateDeltaChange={setBulkEstimateDelta}
                  onBulkPaste={handleBulkPasteTasks}
                  onBulkPasteTextChange={setBulkPasteText}
                  onBulkRoleChange={handleBulkRoleChange}
                  onBulkShiftDate={handleBulkShiftDates}
                  onBulkShiftDaysChange={setBulkShiftDays}
                  onBulkStartDate={handleBulkStartDate}
                  onBulkStartDateChange={setBulkStartDate}
                  onClearSelection={handleClearSelection}
                  onCopy={handleCopyTasks}
                  onDelete={handleDeleteTasks}
                  onDuplicate={handleDuplicateTasks}
                  onMoveDown={() => handleMoveSelectedRows(1)}
                  onMoveUp={() => handleMoveSelectedRows(-1)}
                  onPaste={handlePasteTasks}
                  onSelectAll={handleSelectAllTasks}
                  onTogglePlannerFullscreen={() =>
                    setPlannerFullscreen((current) => !current)
                  }
                  onToggleBulkEdit={() => setShowBulkEdit((current) => !current)}
                  onToggleBulkPaste={() => setShowBulkPaste((current) => !current)}
                />
                <BetaWorkspace
                  document={document}
                  peopleById={peopleById}
                  plannerFullscreen={plannerFullscreen}
                  selectedTaskId={selectedTaskId}
                  selectedTaskIds={selectedTaskIds}
                  timeline={timeline}
                  onAddTask={handleAddTask}
                  onCheckboxChange={handleTaskCheckboxChange}
                  onPrimaryAssigneeChange={handlePrimaryAssigneeChange}
                  onPrimaryEstimateChange={handlePrimaryEstimateChange}
                  onPrimaryRoleChange={handlePrimaryRoleChange}
                  onPrimaryStartChange={handlePrimaryStartChange}
                  onReorderRows={handleReorderRows}
                  onSelectTask={setSelectedTaskId}
                  onTaskRowSelect={handleTaskRowSelect}
                  onTaskPointerDown={handleTaskPointerDown}
                  onTaskTitleChange={handleTaskTitleChange}
                />
              </div>
            )}
            {document.view.panel === 'workload' && (
              <WorkloadPanel people={document.plan.people} loadsByPersonId={loadsByPersonId} />
            )}
            {document.view.panel === 'conflicts' && (
              <ConflictPanel conflicts={conflicts} onSelectTask={setSelectedTaskId} />
            )}
          </>
        )}
      </section>

      {selectedTask && (
        <TaskInspector
          task={selectedTask}
          peopleById={peopleById}
          onClose={() => setInspectedTaskId(null)}
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

function BulkTaskToolbar({
  activeTaskCount,
  bulkEstimateDelta,
  bulkPasteText,
  bulkShiftDays,
  bulkStartDate,
  clipboardTaskCount,
  people,
  plannerFullscreen,
  selectedTaskCount,
  showBulkEdit,
  showBulkPaste,
  onAddTask,
  onBulkAssigneeChange,
  onBulkEstimateDelta,
  onBulkEstimateDeltaChange,
  onBulkPaste,
  onBulkPasteTextChange,
  onBulkRoleChange,
  onBulkShiftDate,
  onBulkShiftDaysChange,
  onBulkStartDate,
  onBulkStartDateChange,
  onClearSelection,
  onCopy,
  onDelete,
  onDuplicate,
  onMoveDown,
  onMoveUp,
  onPaste,
  onSelectAll,
  onTogglePlannerFullscreen,
  onToggleBulkEdit,
  onToggleBulkPaste,
}: {
  activeTaskCount: number;
  bulkEstimateDelta: number;
  bulkPasteText: string;
  bulkShiftDays: number;
  bulkStartDate: string;
  clipboardTaskCount: number;
  people: GanttBuilderPerson[];
  plannerFullscreen: boolean;
  selectedTaskCount: number;
  showBulkEdit: boolean;
  showBulkPaste: boolean;
  onAddTask: () => void;
  onBulkAssigneeChange: (assigneeId: string) => void;
  onBulkEstimateDelta: (deltaHours: number) => void;
  onBulkEstimateDeltaChange: (deltaHours: number) => void;
  onBulkPaste: () => void;
  onBulkPasteTextChange: (text: string) => void;
  onBulkRoleChange: (role: ProjectRole | '') => void;
  onBulkShiftDate: (days: number) => void;
  onBulkShiftDaysChange: (days: number) => void;
  onBulkStartDate: () => void;
  onBulkStartDateChange: (date: string) => void;
  onClearSelection: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onTogglePlannerFullscreen: () => void;
  onToggleBulkEdit: () => void;
  onToggleBulkPaste: () => void;
}) {
  const hasActiveTasks = activeTaskCount > 0;

  return (
    <section className="border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onAddTask}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5" />
          Add row
        </button>
        <button
          type="button"
          onClick={onTogglePlannerFullscreen}
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
          title={plannerFullscreen ? 'Exit fullscreen' : 'Fullscreen planner'}
        >
          {plannerFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
          {activeTaskCount} selected
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
          title="Select all visible rows"
        >
          <CheckSquare className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          disabled={selectedTaskCount === 0}
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!hasActiveTasks}
          title="Move selected up (Alt+Up)"
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!hasActiveTasks}
          title="Move selected down (Alt+Down)"
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onCopy}
          disabled={!hasActiveTasks}
          title="Copy selected (Ctrl+C)"
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onPaste}
          disabled={clipboardTaskCount === 0}
          title="Paste copied tasks (Ctrl+V)"
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Paste{clipboardTaskCount > 0 ? ` ${clipboardTaskCount}` : ''}
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={!hasActiveTasks}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!hasActiveTasks}
          title="Delete selected"
          className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-white p-1.5 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleBulkEdit}
          className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
            showBulkEdit
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Bulk edit
        </button>
        <button
          type="button"
          onClick={onToggleBulkPaste}
          className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
            showBulkPaste
              ? 'border-sky-500 bg-sky-50 text-sky-800'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Paste rows
        </button>
      </div>

      {showBulkEdit && (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
        <select
          aria-label="Bulk assignee"
          disabled={!hasActiveTasks}
          onChange={(event) => onBulkAssigneeChange(event.target.value)}
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
          defaultValue=""
        >
          <option value="">Set assignee...</option>
          <option value="">Unassigned</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Bulk role"
          disabled={!hasActiveTasks}
          onChange={(event) => onBulkRoleChange(event.target.value as ProjectRole | '')}
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
          defaultValue=""
        >
          <option value="">Set role...</option>
          <option value="">No role</option>
          {PROJECT_ROLE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          aria-label="Shift days"
          value={bulkShiftDays}
          onChange={(event) => onBulkShiftDaysChange(event.target.valueAsNumber)}
          className="h-8 w-20 rounded-md border border-slate-200 px-2 text-right text-xs font-semibold tabular-nums outline-none focus:ring-2 focus:ring-sky-100"
        />
        <button
          type="button"
          onClick={() => onBulkShiftDate(bulkShiftDays)}
          disabled={!hasActiveTasks}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Shift days
        </button>
        <input
          type="date"
          aria-label="Bulk start date"
          value={bulkStartDate}
          onChange={(event) => onBulkStartDateChange(event.target.value)}
          className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-sky-100"
        />
        <button
          type="button"
          onClick={onBulkStartDate}
          disabled={!hasActiveTasks || !bulkStartDate}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Set start
        </button>
        <input
          type="number"
          aria-label="Estimate delta"
          value={bulkEstimateDelta}
          step={0.25}
          onChange={(event) => onBulkEstimateDeltaChange(event.target.valueAsNumber)}
          className="h-8 w-20 rounded-md border border-slate-200 px-2 text-right text-xs font-semibold tabular-nums outline-none focus:ring-2 focus:ring-sky-100"
        />
        <button
          type="button"
          onClick={() => onBulkEstimateDelta(bulkEstimateDelta)}
          disabled={!hasActiveTasks}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Shift hours
        </button>
      </div>
      )}

      {showBulkPaste && (
        <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
              Paste rows: title, start date, hours, assignee, role
            </span>
            <textarea
              value={bulkPasteText}
              onChange={(event) => onBulkPasteTextChange(event.target.value)}
              rows={4}
              placeholder="Task title\t2026-05-18\t8\tAlex\tBackend"
              className="w-full resize-y rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <button
            type="button"
            onClick={onBulkPaste}
            disabled={!bulkPasteText.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add pasted rows
          </button>
        </div>
      )}
    </section>
  );
}

function BetaWorkspace({
  document,
  peopleById,
  plannerFullscreen,
  selectedTaskId,
  selectedTaskIds,
  timeline,
  onAddTask,
  onCheckboxChange,
  onPrimaryAssigneeChange,
  onPrimaryEstimateChange,
  onPrimaryRoleChange,
  onPrimaryStartChange,
  onReorderRows,
  onSelectTask,
  onTaskRowSelect,
  onTaskPointerDown,
  onTaskTitleChange,
}: {
  document: GanttBuilderNewDocument;
  peopleById: Map<string, GanttBuilderPerson>;
  plannerFullscreen: boolean;
  selectedTaskId: string | null;
  selectedTaskIds: Set<string>;
  timeline: ReturnType<typeof buildTimelineModel>;
  onAddTask: (afterTaskId?: string) => void;
  onCheckboxChange: (taskId: string, checked: boolean, event: ReactMouseEvent) => void;
  onPrimaryAssigneeChange: (taskId: string, assigneeId: string) => void;
  onPrimaryEstimateChange: (taskId: string, estimateHours: number) => void;
  onPrimaryRoleChange: (taskId: string, role: ProjectRole | '') => void;
  onPrimaryStartChange: (taskId: string, startDate: string) => void;
  onReorderRows: (
    draggedTaskIds: string[],
    targetTaskId: string,
    position: RowDropPosition
  ) => void;
  onSelectTask: (taskId: string) => void;
  onTaskRowSelect: (taskId: string, event: ReactMouseEvent) => void;
  onTaskPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    task: GanttBuilderTask,
    mode: TimelineInteractionMode,
    dragStepWidth: number
  ) => void;
  onTaskTitleChange: (taskId: string, title: string) => void;
}) {
  const { plan } = document;
  const orderedTasks = useMemo(() => sortTasksForDisplay(plan.tasks), [plan.tasks]);
  const [taskGridWidth, setTaskGridWidth] = useState(DEFAULT_TASK_GRID_WIDTH);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const workspaceWidth = useElementWidth(workspaceRef);
  const effectiveTimelineWidth = Math.max(0, workspaceWidth - taskGridWidth);
  const visibleTimeline = useMemo(
    () => stretchTimelineModel(timeline, Math.max(timeline.totalWidth, effectiveTimelineWidth)),
    [effectiveTimelineWidth, timeline]
  );
  const timelineCanvasWidth = visibleTimeline.totalWidth + TIMELINE_RUNWAY_WIDTH;

  const handleGridResizeStart = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const originX = event.clientX;
    const originWidth = taskGridWidth;
    const previousCursor = window.document.body.style.cursor;
    const previousUserSelect = window.document.body.style.userSelect;
    window.document.body.style.cursor = 'col-resize';
    window.document.body.style.userSelect = 'none';

    const onPointerMove = (moveEvent: PointerEvent) => {
      setTaskGridWidth(
        clamp(originWidth + moveEvent.clientX - originX, MIN_TASK_GRID_WIDTH, MAX_TASK_GRID_WIDTH)
      );
    };
    const stop = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.document.body.style.cursor = previousCursor;
      window.document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };

  const handleTimelinePanStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-timeline-bar="true"]')) return;

    const scroller = workspaceRef.current;
    if (!scroller) return;

    event.preventDefault();
    event.stopPropagation();

    const originX = event.clientX;
    const originScrollLeft = scroller.scrollLeft;
    const previousCursor = window.document.body.style.cursor;
    const previousUserSelect = window.document.body.style.userSelect;
    window.document.body.style.cursor = 'grabbing';
    window.document.body.style.userSelect = 'none';

    const onPointerMove = (moveEvent: PointerEvent) => {
      scroller.scrollLeft = originScrollLeft - (moveEvent.clientX - originX);
    };
    const stop = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.document.body.style.cursor = previousCursor;
      window.document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };

  if (plan.tasks.length === 0) {
    return (
      <div className="border-t border-slate-200 p-8 text-sm text-slate-500">
        <div>No tasks in this beta plan yet. Load GitLab tasks, import a classic plan, or add one manually.</div>
        <button
          type="button"
          onClick={() => onAddTask()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5" />
          Add first task
        </button>
      </div>
    );
  }

  return (
    <div
      ref={workspaceRef}
      className={`w-full overflow-auto overscroll-contain ${
        plannerFullscreen ? 'min-h-0 flex-1' : 'max-h-[calc(100vh-280px)]'
      }`}
      style={{ scrollbarGutter: 'stable both-edges' }}
    >
      <div
        style={{
          minWidth: taskGridWidth + timeline.totalWidth + TIMELINE_RUNWAY_WIDTH,
          width: '100%',
        }}
      >
        <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white">
          <div
            className="sticky left-0 z-20 grid shrink-0 items-center border-r border-slate-200 bg-slate-100 px-3 text-[10px] font-semibold uppercase text-slate-500"
            style={{ width: taskGridWidth, height: HEADER_HEIGHT }}
          >
            <div className="grid items-center gap-2" style={{ gridTemplateColumns: TASK_GRID_TEMPLATE }}>
              <span>
                <CheckSquare className="h-3.5 w-3.5" />
              </span>
              <span />
              <span>Task</span>
              <span>Start</span>
              <span>Hours</span>
              <span>Assignee</span>
              <span>Role</span>
              <span>End</span>
            </div>
            <button
              type="button"
              aria-label="Resize task grid"
              onPointerDown={handleGridResizeStart}
              className="absolute right-[-4px] top-0 z-30 h-full w-2 cursor-col-resize border-x border-transparent hover:border-sky-300 hover:bg-sky-100/70"
            />
          </div>
          <div
            className="relative grid shrink-0 cursor-grab bg-white active:cursor-grabbing"
            onPointerDown={handleTimelinePanStart}
            style={{
              width: timelineCanvasWidth,
              height: HEADER_HEIGHT,
              gridTemplateColumns: [
                ...visibleTimeline.columns.map((column) => `${column.width}px`),
                `${TIMELINE_RUNWAY_WIDTH}px`,
              ].join(' '),
            }}
          >
            {visibleTimeline.columns.map((column, index) => (
              <div
                key={column.id}
                className={`px-2 py-1.5 text-center ${
                  index === visibleTimeline.columns.length - 1 ? '' : 'border-r border-slate-200'
                }`}
                title={`${column.dates[0]} - ${column.dates[column.dates.length - 1]}`}
              >
                <div className="text-[11px] font-semibold leading-4 text-slate-900">
                  {column.label}
                </div>
                <div className="text-[10px] leading-3 text-slate-500">{column.subLabel}</div>
                {visibleTimeline.hourDivisions && (
                  <div className="mt-1 grid h-3 grid-cols-8 overflow-hidden rounded-sm border border-slate-200 bg-white text-[8px] leading-3 text-slate-500">
                    {visibleTimeline.hourDivisions.map((hour) => (
                      <div key={hour} className="border-r border-slate-200 last:border-r-0">
                        {hour}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div aria-hidden="true" className="bg-white" />
            {visibleTimeline.todayLeft !== null && (
              <div
                className="pointer-events-none absolute top-0 h-full w-0.5 bg-sky-500"
                style={{ left: visibleTimeline.todayLeft }}
              />
            )}
          </div>
        </div>

        {orderedTasks.map((task) => (
          <TaskTimelineRow
            key={task.id}
            task={task}
            plan={plan}
            peopleById={peopleById}
            selected={task.id === selectedTaskId}
            checked={selectedTaskIds.has(task.id)}
            dragTaskIds={
              selectedTaskIds.has(task.id) && selectedTaskIds.size > 1
                ? Array.from(selectedTaskIds)
                : [task.id]
            }
            movingWithSelection={selectedTaskIds.has(task.id) && selectedTaskIds.size > 1}
            timeline={visibleTimeline}
            timelineCanvasWidth={timelineCanvasWidth}
            taskGridWidth={taskGridWidth}
            onTimelinePanStart={handleTimelinePanStart}
            onAddAfter={() => onAddTask(task.id)}
            onCheckboxChange={onCheckboxChange}
            onPrimaryAssigneeChange={onPrimaryAssigneeChange}
            onPrimaryEstimateChange={onPrimaryEstimateChange}
            onPrimaryRoleChange={onPrimaryRoleChange}
            onPrimaryStartChange={onPrimaryStartChange}
            onReorderRows={onReorderRows}
            onSelect={() => onSelectTask(task.id)}
            onTaskRowSelect={(event) => onTaskRowSelect(task.id, event)}
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
  checked,
  dragTaskIds,
  movingWithSelection,
  timeline,
  timelineCanvasWidth,
  taskGridWidth,
  onTimelinePanStart,
  onAddAfter,
  onCheckboxChange,
  onPrimaryAssigneeChange,
  onPrimaryEstimateChange,
  onPrimaryRoleChange,
  onPrimaryStartChange,
  onReorderRows,
  onSelect,
  onTaskRowSelect,
  onTaskPointerDown,
  onTaskTitleChange,
}: {
  task: GanttBuilderTask;
  plan: GanttBuilderNewDocument['plan'];
  peopleById: Map<string, GanttBuilderPerson>;
  selected: boolean;
  checked: boolean;
  dragTaskIds: string[];
  movingWithSelection: boolean;
  timeline: ReturnType<typeof buildTimelineModel>;
  timelineCanvasWidth: number;
  taskGridWidth: number;
  onTimelinePanStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onAddAfter: () => void;
  onCheckboxChange: (taskId: string, checked: boolean, event: ReactMouseEvent) => void;
  onPrimaryAssigneeChange: (taskId: string, assigneeId: string) => void;
  onPrimaryEstimateChange: (taskId: string, estimateHours: number) => void;
  onPrimaryRoleChange: (taskId: string, role: ProjectRole | '') => void;
  onPrimaryStartChange: (taskId: string, startDate: string) => void;
  onReorderRows: (
    draggedTaskIds: string[],
    targetTaskId: string,
    position: RowDropPosition
  ) => void;
  onSelect: () => void;
  onTaskRowSelect: (event: ReactMouseEvent) => void;
  onTaskPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    task: GanttBuilderTask,
    mode: TimelineInteractionMode,
    dragStepWidth: number
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
      onClick={onTaskRowSelect}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const draggedTaskIds = getDraggedTaskIds(event);
        if (draggedTaskIds.length === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
        onReorderRows(draggedTaskIds, task.id, position);
      }}
      className={`flex w-full text-left transition ${
        selected || checked ? 'bg-sky-50' : 'bg-white hover:bg-slate-50'
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <div
        className={`sticky left-0 z-[2] grid shrink-0 items-center gap-2 border-r border-t px-3 ${
          selected || checked ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white'
        }`}
        style={{ width: taskGridWidth, gridTemplateColumns: TASK_GRID_TEMPLATE }}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${task.title}`}
          onClick={(event) => onCheckboxChange(task.id, event.currentTarget.checked, event)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-sky-700 focus:ring-sky-200"
        />
        <button
          type="button"
          draggable
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.dataTransfer.setData(
              'application/x-gantt-task-ids',
              JSON.stringify(dragTaskIds)
            );
            event.dataTransfer.setData('text/plain', task.id);
            event.dataTransfer.effectAllowed = 'move';
            onSelect();
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          title={movingWithSelection ? 'Drag selected rows' : 'Drag row'}
        >
          <GripHorizontal className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0">
          <input
            type="text"
            value={task.title}
            aria-label="Task title"
            title={assigneeNames}
            onChange={(event) => onTaskTitleChange(task.id, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAddAfter();
              }
            }}
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-slate-900 outline-none focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100"
          />
        </div>
        <input
          type="date"
          value={primaryStartDate}
          aria-label="Start date"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onPrimaryStartChange(task.id, event.target.value)}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        />
        <input
          type="number"
          min={MIN_TASK_ESTIMATE_HOURS}
          step={0.25}
          value={primaryEstimateHours}
          aria-label="Estimate hours"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onPrimaryEstimateChange(task.id, event.target.valueAsNumber)}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-right text-xs font-semibold tabular-nums text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        />
        <select
          value={primaryAssigneeId}
          aria-label="Primary assignee"
          onClick={(event) => event.stopPropagation()}
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
          onClick={(event) => event.stopPropagation()}
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
        className="relative shrink-0 cursor-grab border-t border-slate-100 active:cursor-grabbing"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={onTimelinePanStart}
        style={{ width: timelineCanvasWidth, height: ROW_HEIGHT }}
      >
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: [
              ...timeline.columns.map((column) => `${column.width}px`),
              `${TIMELINE_RUNWAY_WIDTH}px`,
            ].join(' '),
          }}
        >
          {timeline.columns.map((column, index) => {
            const allNonWorking = column.dates.every(
              (date) => !isPlanWorkingDay(date, plan.nonWorkingDates)
            );
            return (
              <div
                key={column.id}
                className={`${index === timeline.columns.length - 1 ? '' : 'border-r border-slate-100'} ${
                  allNonWorking ? 'bg-amber-50/70' : 'bg-white'
                }`}
              >
                {timeline.hourDivisions && (
                  <div className="grid h-full grid-cols-8">
                    {timeline.hourDivisions.map((hour) => (
                      <div key={hour} className="border-r border-slate-100 last:border-r-0" />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div aria-hidden="true" className="bg-white" />
        </div>
        {timeline.todayLeft !== null && (
          <div
            className="pointer-events-none absolute top-0 h-full w-0.5 bg-sky-500/70"
            style={{ left: timeline.todayLeft }}
          />
        )}
        {bar && (
          <div
            data-timeline-bar="true"
            onPointerDown={(event) => onTaskPointerDown(event, task, 'move', timeline.dragStepWidth)}
            className={`absolute top-3 flex h-9 touch-none select-none items-center overflow-hidden rounded-md border px-2 pr-4 text-[11px] font-semibold shadow-sm ${
              isOutside
                ? 'cursor-grab border-amber-300 bg-amber-100 text-amber-950'
                : selected || checked
                  ? 'cursor-grab border-sky-400 bg-sky-100 text-sky-950'
                  : 'cursor-grab border-slate-300 bg-slate-100 text-slate-800'
            }`}
            style={{ left: bar.left, width: Math.max(12, bar.width) }}
            title={
              movingWithSelection
                ? `${task.title}: moving ${dragTaskIds.length} selected tasks in row order`
                : `${task.title}: ${task.startDate} - ${endDate}`
            }
          >
            <GripHorizontal className="mr-1 h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">{task.title}</span>
            <span className="ml-auto shrink-0 pl-2 tabular-nums">
              {getTaskTotalEstimateHours(task)}h
            </span>
            <button
              type="button"
              aria-label="Resize task estimate"
              onPointerDown={(event) => onTaskPointerDown(event, task, 'resize', timeline.dragStepWidth)}
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
}: {
  people: GanttBuilderPerson[];
  loadsByPersonId: ReturnType<typeof buildCapacityWeekLoads>;
}) {
  const weeks = Array.from(
    new Set(Object.values(loadsByPersonId).flatMap((loads) => loads.map((load) => load.weekStart)))
  ).sort();

  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
        <Users className="h-4 w-4" />
        Workload
      </div>
      <div className="max-h-[calc(100vh-300px)] overflow-auto p-4">
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
  onSelectTask,
}: {
  conflicts: ReturnType<typeof buildGanttBuilderNewConflicts>;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
        <AlertTriangle className="h-4 w-4" />
        Conflicts
      </div>
      <div className="max-h-[calc(100vh-300px)] overflow-auto p-4">
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

function useElementWidth(ref: RefObject<HTMLElement>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = () => setWidth(element.clientWidth);
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function sortTasksForDisplay(tasks: GanttBuilderTask[]) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort(
      (left, right) =>
        (left.task.order ?? left.index + 1_000_000) -
          (right.task.order ?? right.index + 1_000_000) ||
        left.index - right.index
    )
    .map(({ task }) => task);
}

function toggleTaskSelection(current: Set<string>, taskId: string) {
  const next = new Set(current);
  if (next.has(taskId)) {
    next.delete(taskId);
  } else {
    next.add(taskId);
  }
  return next;
}

function selectTaskRange(tasks: GanttBuilderTask[], fromTaskId: string, toTaskId: string) {
  const fromIndex = tasks.findIndex((task) => task.id === fromTaskId);
  const toIndex = tasks.findIndex((task) => task.id === toTaskId);
  if (fromIndex < 0 || toIndex < 0) return new Set([toTaskId]);
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return new Set(tasks.slice(start, end + 1).map((task) => task.id));
}

function getActiveTaskIds(selectedTaskIds: Set<string>, selectedTaskId: string | null) {
  if (selectedTaskIds.size > 0) return Array.from(selectedTaskIds);
  return selectedTaskId ? [selectedTaskId] : [];
}

function areStringSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function getDraggedTaskIds(event: ReactDragEvent<HTMLElement>) {
  const raw = event.dataTransfer.getData('application/x-gantt-task-ids');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string');
      }
    } catch {
      // Fall through to text/plain below.
    }
  }
  const fallback = event.dataTransfer.getData('text/plain');
  return fallback ? [fallback] : [];
}

function reorderPlanTasks(
  plan: GanttBuilderNewDocument['plan'],
  draggedTaskIds: string[],
  targetTaskId: string,
  position: RowDropPosition
): GanttBuilderNewDocument['plan'] {
  const movingIds = Array.from(new Set(draggedTaskIds));
  if (movingIds.length === 0 || movingIds.includes(targetTaskId)) return plan;

  const movingIdSet = new Set(movingIds);
  const orderedTasks = sortTasksForDisplay(plan.tasks);
  const movingTasks = orderedTasks.filter((task) => movingIdSet.has(task.id));
  if (movingTasks.length === 0) return plan;

  const remainingTasks = orderedTasks.filter((task) => !movingIdSet.has(task.id));
  const targetIndex = remainingTasks.findIndex((task) => task.id === targetTaskId);
  if (targetIndex < 0) return plan;

  remainingTasks.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, ...movingTasks);
  return applyTaskOrder(plan, remainingTasks);
}

function movePlanTasksByStep(
  plan: GanttBuilderNewDocument['plan'],
  taskIds: string[],
  direction: -1 | 1
): GanttBuilderNewDocument['plan'] {
  const movingIdSet = new Set(taskIds);
  if (movingIdSet.size === 0) return plan;

  const orderedTasks = sortTasksForDisplay(plan.tasks);
  if (direction < 0) {
    for (let index = 1; index < orderedTasks.length; index += 1) {
      if (movingIdSet.has(orderedTasks[index].id) && !movingIdSet.has(orderedTasks[index - 1].id)) {
        [orderedTasks[index - 1], orderedTasks[index]] = [orderedTasks[index], orderedTasks[index - 1]];
      }
    }
  } else {
    for (let index = orderedTasks.length - 2; index >= 0; index -= 1) {
      if (movingIdSet.has(orderedTasks[index].id) && !movingIdSet.has(orderedTasks[index + 1].id)) {
        [orderedTasks[index], orderedTasks[index + 1]] = [orderedTasks[index + 1], orderedTasks[index]];
      }
    }
  }

  return applyTaskOrder(plan, orderedTasks);
}

function insertPlanTasks(
  plan: GanttBuilderNewDocument['plan'],
  newTasks: GanttBuilderTask[],
  afterTaskId?: string | null
): GanttBuilderNewDocument['plan'] {
  if (newTasks.length === 0) return plan;
  const orderedTasks = sortTasksForDisplay(plan.tasks);
  const insertIndex = afterTaskId
    ? Math.max(0, orderedTasks.findIndex((task) => task.id === afterTaskId) + 1)
    : orderedTasks.length;
  orderedTasks.splice(insertIndex, 0, ...newTasks);
  return applyTaskOrder(
    {
      ...plan,
      tasks: [...plan.tasks, ...newTasks],
    },
    orderedTasks
  );
}

function deletePlanTasks(
  plan: GanttBuilderNewDocument['plan'],
  taskIds: string[]
): GanttBuilderNewDocument['plan'] {
  const deletingIds = new Set(taskIds);
  const orderedTasks = sortTasksForDisplay(plan.tasks.filter((task) => !deletingIds.has(task.id)));
  return applyTaskOrder(
    {
      ...plan,
      tasks: plan.tasks.filter((task) => !deletingIds.has(task.id)),
    },
    orderedTasks
  );
}

function moveTaskSchedulesByDragDelta(
  plan: GanttBuilderNewDocument['plan'],
  dragState: TimelineDragState,
  dayDelta: number
): GanttBuilderNewDocument['plan'] {
  const selectedIds = new Set(dragState.taskIds);
  const orderedTaskIds = sortTasksForDisplay(plan.tasks)
    .filter((task) => selectedIds.has(task.id))
    .map((task) => task.id);

  return orderedTaskIds.reduce((nextPlan, taskId) => {
    const originStartDate = dragState.originStartDatesByTaskId[taskId];
    if (!originStartDate) return nextPlan;
    return moveTaskSchedule(
      nextPlan,
      taskId,
      resolvePlanWorkingDate(addDays(originStartDate, dayDelta), nextPlan.nonWorkingDates, dayDelta)
    );
  }, plan);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function applyTaskOrder(
  plan: GanttBuilderNewDocument['plan'],
  orderedTasks: GanttBuilderTask[]
): GanttBuilderNewDocument['plan'] {
  const orderByTaskId = new Map(orderedTasks.map((task, index) => [task.id, index + 1]));
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({
      ...task,
      order: orderByTaskId.get(task.id) ?? task.order,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function cloneTask(task: GanttBuilderTask, reason: 'copy' | 'duplicate'): GanttBuilderTask {
  const suffix = reason === 'copy' ? 'copy' : 'duplicate';
  return {
    ...task,
    id: `task:${suffix}:${createLocalId()}`,
    title: `${task.title} (${reason === 'copy' ? 'copy' : 'duplicate'})`,
    source: 'manual',
    issueId: undefined,
    issueIid: undefined,
    issueWebUrl: undefined,
    issueProjectPath: undefined,
    gitlabState: undefined,
    gitlabClosedAt: undefined,
    gitlabDueDate: undefined,
    gitlabUpdatedAt: undefined,
    gitlabLabels: undefined,
    gitlabMilestoneTitle: undefined,
    gitlabAssigneeIds: undefined,
    gitlabAssigneeNames: undefined,
    gitlabTimeEstimateHours: undefined,
    gitlabSpentHours: undefined,
    assignments: task.assignments.map((assignment) => ({
      ...assignment,
      id: `assignment:${createLocalId()}`,
      personEstimates: assignment.personEstimates ? { ...assignment.personEstimates } : undefined,
      personStartDates: assignment.personStartDates ? { ...assignment.personStartDates } : undefined,
    })),
  };
}

function parseBulkTaskText(
  text: string,
  people: GanttBuilderPerson[],
  fallbackStartDate: string
) {
  const peopleByName = new Map(people.map((person) => [person.name.trim().toLowerCase(), person]));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const rolesByText = new Map(
    PROJECT_ROLE_OPTIONS.flatMap((option) => [
      [option.id.toLowerCase(), option.id],
      [option.label.toLowerCase(), option.id],
    ])
  );

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.includes('\t')
        ? line.split('\t')
        : line.split(',').map((cell) => cell.trim());
      const [title, rawStartDate, rawHours, rawAssignee, rawRole] = cells;
      if (!title?.trim()) return null;

      const assignee = rawAssignee
        ? peopleById.get(rawAssignee) ?? peopleByName.get(rawAssignee.toLowerCase()) ?? null
        : null;
      const roleText = rawRole?.trim().toLowerCase();
      const role = roleText ? (rolesByText.get(roleText) as ProjectRole | undefined) ?? null : assignee?.role ?? null;
      const estimateHours = Number(rawHours);
      return createTask({
        title,
        startDate: rawStartDate && isIsoDate(rawStartDate) ? rawStartDate : fallbackStartDate,
        estimateHours: Number.isFinite(estimateHours) && estimateHours > 0 ? estimateHours : DEFAULT_TASK_ESTIMATE_HOURS,
        assigneeIds: assignee ? [assignee.id] : [],
        role,
      });
    })
    .filter((task): task is GanttBuilderTask => Boolean(task));
}

function createLocalId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

function setPanel(
  document: GanttBuilderNewDocument,
  panel: GanttBuilderNewDocument['view']['panel']
) {
  return {
    ...document,
    view: {
      ...document.view,
      panel,
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
    hourDivisions: zoom === 'hours' ? [1, 2, 3, 4, 5, 6, 7, 8] : null,
  };
}

function groupTimelineColumns(dates: string[], zoom: GanttBuilderNewZoom): TimelineColumn[] {
  if (zoom === 'hours' || zoom === 'day') {
    return dates.map((date) => ({
      id: date,
      label: formatDay(date),
      subLabel: formatWeekday(date),
      dates: [date],
      width: zoom === 'hours' ? 128 : 52,
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

function stretchTimelineModel(
  timeline: ReturnType<typeof buildTimelineModel>,
  targetWidth: number
): ReturnType<typeof buildTimelineModel> {
  if (targetWidth <= timeline.totalWidth || timeline.columns.length === 0) return timeline;

  const scale = targetWidth / Math.max(1, timeline.totalWidth);
  const columns = timeline.columns.map((column) => ({
    ...column,
    width: column.width * scale,
  }));
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

  return {
    ...timeline,
    columns,
    datePositions,
    dragStepWidth: firstColumn
      ? firstColumn.width / Math.max(1, firstColumn.dates.length)
      : timeline.dragStepWidth,
    totalWidth: targetWidth,
    todayLeft: todayPosition ? todayPosition.left + todayPosition.width / 2 : null,
  };
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
