import {
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
  GripHorizontal,
  ListPlus,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { ReportResult } from '../types';
import { PROJECT_ROLE_OPTIONS, type ProjectRole } from '../lib/planning';
import {
  DEFAULT_TASK_ESTIMATE_HOURS,
  buildCapacityWeekLoads,
  buildGanttBuilderCalendarDates,
  countPlanWorkingDaysBetween,
  createGanttBuilderContext,
  createManualPerson,
  createTask,
  createTaskAssignment,
  getDailyCapacityHours,
  getGanttBuilderStorageKey,
  getAssignmentPersonHours,
  getRoleLabel,
  getTaskLaneHours,
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
  onBack: () => void;
}

type RoleFilter = ProjectRole | 'all' | 'none';
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
const DAY_WIDTH = 42;
const LANE_WIDTH = 260;
const LANE_HEIGHT = 132;
const BAR_HEIGHT = 30;
const BAR_TOP_OFFSET = 12;
const BAR_SLOT_GAP = 8;
const PM_ROLES = new Set<ProjectRole>(['pm', 'leadPm', 'analytic']);

export function GanttBuilderView({ report, onBack }: Props) {
  const context = useMemo(() => createGanttBuilderContext(report ?? undefined), [report]);
  const [plan, setPlan] = useState<GanttBuilderPlan>(() => loadGanttBuilderPlan(context));
  const [taskTitle, setTaskTitle] = useState('');
  const [taskEstimate, setTaskEstimate] = useState(String(DEFAULT_TASK_ESTIMATE_HOURS));
  const [taskRole, setTaskRole] = useState<ProjectRole | null>(null);
  const [taskAssigneeIds, setTaskAssigneeIds] = useState<string[]>([]);
  const [bulkText, setBulkText] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [personFilter, setPersonFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [dragState, setDragState] = useState<DragState | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  const storageKey = useMemo(() => getGanttBuilderStorageKey(context), [context]);

  useEffect(() => {
    setPlan(loadGanttBuilderPlan(context));
  }, [context, storageKey]);

  useEffect(() => {
    saveGanttBuilderPlan(context, plan);
  }, [context, plan]);

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
      plan.tasks.filter((task) =>
        taskMatchesFilters(task, {
          personFilter,
          roleFilter,
          visibleLaneIds,
        })
      ),
    [personFilter, plan.tasks, roleFilter, visibleLaneIds]
  );
  const overloadedWeeks = Object.values(capacityByPersonId)
    .flat()
    .filter((week) => week.overloaded).length;
  const unassignedTaskCount = plan.tasks.filter((task) =>
    task.assignments.some((assignment) => assignment.assigneeIds.length === 0)
  ).length;
  const timelineWidth = dates.length * DAY_WIDTH;

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

        if (dragState.mode === 'resize') {
          const startIndex = clamp(dragState.originStartIndex, 0, dates.length - 1);
          const endIndex = clamp(dragState.originStartIndex + deltaDays, startIndex, dates.length - 1);
          const workDays = countPlanWorkingDaysBetween(
            dates[startIndex],
            dates[endIndex],
            current.nonWorkingDates
          );
          const assignee =
            dragState.laneId === UNASSIGNED_LANE_ID
              ? undefined
              : current.people.find((person) => person.id === dragState.laneId);
          const estimateHours =
            workDays === dragState.originWorkDays
              ? dragState.originEstimateHours
              : normalizeEstimateHours(workDays * getDailyCapacityHours(assignee));
          return updateTaskLaneEstimate(
            current,
            task.id,
            dragState.assignmentId,
            estimateHours
          );
        }

        const startIndex = clamp(dragState.originStartIndex + deltaDays, 0, dates.length - 1);
        const nextLaneId = getLaneIdAtPointer(event.clientY, rowsRef.current, lanes);
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
  }, [dates, dragState, lanes, visibleLaneIds]);

  const handleCreateTask = () => {
    if (!taskTitle.trim()) return;

    const estimateHours = Number(taskEstimate.replace(',', '.'));
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
      originStartIndex: dateIndexByDate.get(assignment.startDate) ?? 0,
      originWorkDays: getWorkDaysForLaneHours(laneHours, assignee),
      originEstimateHours: laneHours,
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Gantt Builder</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Build a manual plan from tasks, estimates, assignees, and weekly capacity. Bars can
                be dragged between people and resized by workday increments.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>{context.projectPath}</span>
                <span>
                  {context.period.start} - {context.period.end}
                </span>
                {context.source === 'standalone' && <span>Standalone plan</span>}
                <span className="inline-flex items-center gap-1">
                  <Save className="h-3.5 w-3.5" />
                  Saved in localStorage
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            {report ? 'Back to report' : 'Back'}
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ListPlus className="h-5 w-5" />} label="Plan tasks" value={String(plan.tasks.length)} tone="sky" />
        <StatCard icon={<Users className="h-5 w-5" />} label="People" value={String(plan.people.length)} tone="emerald" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Unassigned" value={String(unassignedTaskCount)} tone="amber" />
        <StatCard icon={<SlidersHorizontal className="h-5 w-5" />} label="Overloaded weeks" value={String(overloadedWeeks)} tone={overloadedWeeks > 0 ? 'rose' : 'emerald'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Add task</h3>
            <div className="mt-3 space-y-3">
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

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Bulk add</h3>
            <p className="mt-1 text-xs text-slate-500">
              One non-empty line becomes one task. Optional estimate examples: [16h] API, UI | 12h.
            </p>
            <div className="mt-3">
              <FieldLabel label="Task lines">
                <textarea
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  rows={7}
                  placeholder={'Auth backend\nLogin UI | 12h\n[16h] Settings page'}
                  className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-200"
                />
              </FieldLabel>
            </div>
            <button
              type="button"
              onClick={handleBulkAdd}
              disabled={!bulkText.trim()}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListPlus className="h-4 w-4" />
              Add lines as tasks
            </button>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">People</h3>
            <div className="mt-3 flex gap-2">
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
          </section>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Filters</h3>
                <p className="mt-1 text-xs text-slate-500">
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

          <WeeklyLoadPanel people={filteredPeople} loadsByPersonId={capacityByPersonId} />

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Calendar plan</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Drag bars to change date or assignee. Resize the right edge to change estimate
                    and planned duration. Click a weekday in the header to mark it as an extra day
                    off.
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  {visibleTasks.length} visible task(s), {dates.length} day(s)
                </div>
              </div>
            </div>

            {lanes.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No lanes match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ width: LANE_WIDTH + timelineWidth }}>
                  <div className="flex border-b border-slate-200 bg-slate-100">
                    <div
                      className="shrink-0 border-r border-slate-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
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

          <TaskDateMatrix
            tasks={visibleTasks}
            dates={dates}
            peopleById={peopleById}
            nonWorkingDates={plan.nonWorkingDates}
            colorsByPersonId={colorsByPersonId}
          />

        </section>
      </div>
    </div>
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
  const timelineWidth = dates.length * DAY_WIDTH;

  return (
    <div className="flex border-b border-slate-200 last:border-b-0" style={{ height: LANE_HEIGHT }}>
      <div
        className="shrink-0 border-r border-slate-200 bg-slate-50 px-3 py-3"
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
              className={`border-r border-slate-200 ${
                isPlanWorkingDay(date, nonWorkingDates)
                  ? ''
                  : nonWorkingDates.includes(date)
                    ? 'bg-rose-50/90'
                    : 'bg-amber-50/80'
              }`}
            />
          ))}
        </div>

        {tasks.flatMap((task) =>
          task.assignments
            .filter((assignment) =>
              lane.id === UNASSIGNED_LANE_ID
                ? assignment.assigneeIds.length === 0
                : assignment.assigneeIds.includes(lane.id)
            )
            .map((assignment) => ({ task, assignment }))
        ).map(({ task, assignment }, index) => {
          const lanePersonId = lane.id === UNASSIGNED_LANE_ID ? null : lane.id;
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
          const width = Math.max(DAY_WIDTH - 8, (endIndex - startIndex + 1) * DAY_WIDTH - 8);
          const top = BAR_TOP_OFFSET + (index % 3) * (BAR_HEIGHT + BAR_SLOT_GAP);
          const color = lanePersonId ? colorsByPersonId[lanePersonId] : undefined;
          const laneHours = roundHours(scheduledEntries.reduce((sum, entry) => sum + entry.hours, 0));
          const warning = getAssignmentTimingWarning(task, assignment);

          return (
            <div
              key={`${task.id}-${assignment.id}-${lane.id}`}
              onPointerDown={(event) =>
                onTaskPointerDown(event, lane.id, task, assignment.id, 'move')
              }
              className={`absolute flex cursor-grab items-center rounded-md border px-2 text-xs font-semibold shadow-sm active:cursor-grabbing ${
                warning ? 'ring-2 ring-amber-400' : ''
              }`}
              style={{
                left: startIndex * DAY_WIDTH + 4,
                top,
                width,
                height: BAR_HEIGHT,
                backgroundColor: color?.fill ?? '#fef3c7',
                borderColor: color?.border ?? '#f59e0b',
                color: color?.text ?? '#78350f',
              }}
              title={`${task.title} / ${getRoleLabel(assignment.role)}: ${laneHours}h on this lane, ${getWorkDaysForLaneHours(laneHours, assignee)} workday(s)${warning ? `. ${warning}` : ''}`}
            >
              <GripHorizontal className="mr-1 h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate">
                {task.title} · {getRoleLabel(assignment.role)}
              </span>
              <span className="ml-2 shrink-0 tabular-nums">{laneHours}h</span>
              <button
                type="button"
                onPointerDown={(event) =>
                  onTaskPointerDown(event, lane.id, task, assignment.id, 'resize')
                }
                className="ml-1 h-6 w-2 cursor-ew-resize rounded-sm bg-black/15 transition hover:bg-black/25"
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
  peopleById,
  nonWorkingDates,
  colorsByPersonId,
}: {
  tasks: GanttBuilderTask[];
  dates: string[];
  peopleById: Map<string, GanttBuilderPerson>;
  nonWorkingDates: string[];
  colorsByPersonId: Record<string, PersonColor>;
}) {
  const timelineWidth = dates.length * DAY_WIDTH;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Task/date matrix</h3>
            <p className="mt-1 text-xs text-slate-500">
              Rows are tasks, columns are dates, colored cells show who is scheduled to work.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {tasks.length} task row(s), {dates.length} date column(s)
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="p-8 text-sm text-slate-500">No tasks match the current filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ width: LANE_WIDTH + timelineWidth }}>
            <div className="flex border-b border-slate-200 bg-slate-100">
              <div
                className="shrink-0 border-r border-slate-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
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
                    className={`border-r border-slate-200 px-1 py-1.5 text-center ${
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
                const entriesByDate = groupScheduleEntriesByDate(
                  getTaskScheduleEntries(task, peopleById, nonWorkingDates)
                );

                return (
                  <div key={task.id} className="flex min-h-[54px]">
                    <div
                      className="shrink-0 border-r border-slate-200 bg-slate-50 px-3 py-2"
                      style={{ width: LANE_WIDTH }}
                    >
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {task.title}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {formatTaskAssignmentsSummary(task, peopleById)}
                      </div>
                    </div>
                    <div
                      className="grid shrink-0"
                      style={{
                        width: timelineWidth,
                        gridTemplateColumns: `repeat(${dates.length}, ${DAY_WIDTH}px)`,
                      }}
                    >
                      {dates.map((date) => {
                        const entries = entriesByDate.get(date) ?? [];
                        return (
                          <div
                            key={date}
                            className={`flex min-h-[54px] items-center justify-center border-r border-slate-200 px-1 ${
                              isPlanWorkingDay(date, nonWorkingDates)
                                ? ''
                                : nonWorkingDates.includes(date)
                                  ? 'bg-rose-50/90'
                                  : 'bg-amber-50/80'
                            }`}
                          >
                            {entries.length > 0 && (
                              <div className="flex max-w-full flex-wrap justify-center gap-0.5">
                                {entries.slice(0, 3).map((entry) => {
                                  const color = entry.personId
                                    ? colorsByPersonId[entry.personId]
                                    : undefined;
                                  const assignment = task.assignments.find(
                                    (candidate) => candidate.id === entry.assignmentId
                                  );
                                  const warning = assignment
                                    ? getAssignmentTimingWarning(task, assignment)
                                    : null;
                                  return (
                                    <div
                                      key={`${entry.assignmentId}-${entry.personId ?? 'unassigned'}`}
                                      className={`h-6 min-w-6 rounded-md border px-1 text-center text-[9px] font-bold leading-6 ${
                                        warning ? 'ring-2 ring-amber-400' : ''
                                      }`}
                                      style={{
                                        backgroundColor: color?.fill ?? '#fef3c7',
                                        borderColor: color?.border ?? '#f59e0b',
                                        color: color?.text ?? '#78350f',
                                      }}
                                      title={`${task.title}: ${entry.personName}, ${getRoleLabel(entry.role)}, ${entry.hours}h on ${date}${warning ? `. ${warning}` : ''}`}
                                    >
                                      {entry.personId ? getInitials(entry.personName) : '?'}
                                    </div>
                                  );
                                })}
                                {entries.length > 3 && (
                                  <div className="h-6 min-w-6 rounded-md border border-slate-200 bg-white px-1 text-center text-[9px] font-bold leading-6 text-slate-500">
                                    +{entries.length - 3}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
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

function WeeklyLoadPanel({
  people,
  loadsByPersonId,
}: {
  people: GanttBuilderPerson[];
  loadsByPersonId: Record<string, CapacityWeekLoad[]>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Weekly capacity</h3>
          <p className="mt-1 text-xs text-slate-500">Each person defaults to a 40h week.</p>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="mt-4 text-sm text-slate-500">No developers match the current filters.</div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {people.map((person) => {
            const loads = loadsByPersonId[person.id] || [];
            const hasOverload = loads.some((load) => load.overloaded);

            return (
              <div
                key={person.id}
                className={`rounded-xl border px-3 py-3 ${
                  hasOverload ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {person.name}
                    </div>
                    <div className="text-[11px] text-slate-500">{getRoleLabel(person.role)}</div>
                  </div>
                  <div className="text-xs font-semibold text-slate-700">
                    {person.weeklyCapacityHours}h/week
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {loads.length === 0 ? (
                    <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500">
                      no scheduled work
                    </span>
                  ) : (
                    loads.map((load) => (
                      <span
                        key={load.weekStart}
                        className={`rounded-md border px-2 py-1 text-[11px] font-semibold tabular-nums ${
                          load.overloaded
                            ? 'border-rose-200 bg-white text-rose-700'
                            : 'border-emerald-200 bg-white text-emerald-700'
                        }`}
                      >
                        {formatShortDate(load.weekStart)} {load.hours}/{load.capacityHours}h
                      </span>
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
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Task table</h3>
            <p className="mt-1 text-xs text-slate-500">
              Each task can contain multiple role estimates and multiple people per role.
            </p>
          </div>
          <div className="text-xs text-slate-500">{tasks.length} task(s)</div>
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
    <div className="space-y-4 px-4 py-4">
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

      <div className="rounded-xl border border-slate-200">
        <div className="hidden grid-cols-[150px_96px_150px_minmax(220px,1fr)_72px] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 lg:grid">
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
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2">
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
    const parsed = Number(estimateDraft.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange({ estimateHours: normalizeEstimateHours(parsed) });
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
        <div className="mt-1 text-[11px] text-slate-500">
          {formatAssignmentPeopleSummary(assignment, peopleById)}
        </div>
        {warning && <div className="mt-1 text-[11px] font-semibold text-amber-700">{warning}</div>}
      </FieldLabel>
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
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
    <div className={`rounded-xl border p-4 ${toneClasses[tone]}`}>
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
                estimateHours: normalizeEstimateHours(laneEstimateHours),
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
            return baseAssignment;
          }

          if (fromPersonId === null && assignment.assigneeIds.length === 0) {
            return {
              ...baseAssignment,
              role: baseAssignment.role ?? toPerson?.role ?? null,
              assigneeIds: toPersonId ? [toPersonId] : [],
            };
          }

          if (fromPersonId && assignment.assigneeIds.includes(fromPersonId)) {
            const nextIds = assignment.assigneeIds
              .map((personId) => (personId === fromPersonId ? toPersonId : personId))
              .filter((personId): personId is string => Boolean(personId));
            return {
              ...baseAssignment,
              role: baseAssignment.role ?? toPerson?.role ?? null,
              assigneeIds: Array.from(new Set(nextIds)),
            };
          }

          return baseAssignment;
        }),
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
      })),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function getLaneIdAtPointer(
  clientY: number,
  rowsElement: HTMLDivElement | null,
  lanes: Lane[]
) {
  if (!rowsElement) return null;
  const rect = rowsElement.getBoundingClientRect();
  const index = Math.floor((clientY - rect.top) / LANE_HEIGHT);
  return lanes[index]?.id ?? null;
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

function taskHasLaneWork(task: GanttBuilderTask, personId: string | null) {
  return getTaskLaneHours(task, personId) > 0;
}

function groupScheduleEntriesByDate(entries: ReturnType<typeof getTaskScheduleEntries>) {
  const byDate = new Map<string, typeof entries>();
  for (const entry of entries) {
    const dateEntries = byDate.get(entry.date) ?? [];
    dateEntries.push(entry);
    byDate.set(entry.date, dateEntries);
  }
  return byDate;
}

function formatTaskAssignmentsSummary(
  task: GanttBuilderTask,
  peopleById: Map<string, GanttBuilderPerson>
) {
  const parts = task.assignments.map((assignment) => {
    const people =
      assignment.assigneeIds.length > 0
        ? assignment.assigneeIds
            .map((personId) => peopleById.get(personId)?.name)
            .filter(Boolean)
            .join(', ')
        : 'Unassigned';
    return `${getRoleLabel(assignment.role)} ${assignment.estimateHours}h: ${people}`;
  });

  return parts.join(' | ');
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

function getWorkDaysForLaneHours(hours: number, person?: GanttBuilderPerson) {
  return Math.max(1, Math.ceil(hours / getDailyCapacityHours(person)));
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

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
  }).format(new Date(`${date}T00:00:00Z`));
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

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}
