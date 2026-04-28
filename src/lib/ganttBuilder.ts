import type { ReportResult } from '../types';
import { PROJECT_ROLE_OPTIONS, type ProjectRole } from './planning';

export type GanttBuilderPersonSource = 'gitlab' | 'manual';

export interface GanttBuilderPerson {
  id: string;
  name: string;
  role: ProjectRole | null;
  source: GanttBuilderPersonSource;
  weeklyCapacityHours: number;
}

export interface GanttBuilderTaskAssignment {
  id: string;
  role: ProjectRole | null;
  estimateHours: number;
  startDate: string;
  assigneeIds: string[];
  personEstimates?: Record<string, number>;
  personStartDates?: Record<string, string>;
}

export interface GanttBuilderTask {
  id: string;
  title: string;
  startDate: string;
  assignments: GanttBuilderTaskAssignment[];
}

export interface GanttBuilderPlan {
  people: GanttBuilderPerson[];
  tasks: GanttBuilderTask[];
  nonWorkingDates: string[];
  updatedAt: string;
}

export interface GanttBuilderContext {
  projectPath: string;
  period: { start: string; end: string };
  people: GanttBuilderPerson[];
  source: 'standalone' | 'report';
}

export interface CapacityDayLoad {
  date: string;
  hours: number;
}

export interface CapacityWeekLoad {
  weekStart: string;
  hours: number;
  capacityHours: number;
  overloaded: boolean;
}

export interface GanttBuilderScheduleEntry {
  taskId: string;
  assignmentId: string;
  date: string;
  personId: string | null;
  personName: string;
  role: ProjectRole | null;
  hours: number;
}

export const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;
export const DEFAULT_DAILY_CAPACITY_HOURS = DEFAULT_WEEKLY_CAPACITY_HOURS / 5;
export const DEFAULT_TASK_ESTIMATE_HOURS = 8;

const STORAGE_PREFIX = 'gtr.ganttBuilder';

export function createGanttBuilderContext(report?: ReportResult): GanttBuilderContext {
  if (report) {
    return {
      projectPath: report.projectPath,
      period: report.period,
      people: buildPeopleFromReport(report),
      source: 'report',
    };
  }

  const start = new Date().toISOString().slice(0, 10);
  const end = addDays(start, 30);

  return {
    projectPath: 'standalone-plan',
    period: { start, end },
    people: [],
    source: 'standalone',
  };
}

export function getGanttBuilderStorageKey(context: GanttBuilderContext) {
  if (context.source === 'standalone') {
    return `${STORAGE_PREFIX}:standalone-plan`;
  }

  return [
    STORAGE_PREFIX,
    context.projectPath,
    context.period.start,
    context.period.end,
  ]
    .map((part) => part.replace(/[^a-z0-9_.:-]+/gi, '-').replace(/^-+|-+$/g, ''))
    .join(':');
}

export function createInitialGanttBuilderPlan(context: GanttBuilderContext): GanttBuilderPlan {
  return {
    people: context.people,
    tasks: [],
    nonWorkingDates: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadGanttBuilderPlan(context: GanttBuilderContext): GanttBuilderPlan {
  const fallback = createInitialGanttBuilderPlan(context);

  try {
    const raw = localStorage.getItem(getGanttBuilderStorageKey(context));
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<GanttBuilderPlan>;
    const people = Array.isArray(parsed.people)
      ? parsed.people.filter(isStoredPerson)
      : [];
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const nonWorkingDates = Array.isArray(parsed.nonWorkingDates)
      ? parsed.nonWorkingDates.filter((value): value is string => typeof value === 'string')
      : [];

    return normalizePlanForReport(
      {
        people,
        tasks: rawTasks,
        nonWorkingDates,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      },
      context
    );
  } catch {
    return fallback;
  }
}

export function saveGanttBuilderPlan(context: GanttBuilderContext, plan: GanttBuilderPlan) {
  localStorage.setItem(
    getGanttBuilderStorageKey(context),
    JSON.stringify({
      ...plan,
      updatedAt: new Date().toISOString(),
    })
  );
}

export function normalizePlanForReport(
  plan: Omit<GanttBuilderPlan, 'tasks'> & { tasks: unknown[] },
  context: GanttBuilderContext
): GanttBuilderPlan {
  const peopleById = new Map(plan.people.map((person) => [person.id, person]));

  for (const person of context.people) {
    if (!peopleById.has(person.id)) {
      peopleById.set(person.id, person);
    }
  }

  const people = Array.from(peopleById.values())
    .map((person) => ({
      ...person,
      name: person.name.trim() || 'Unnamed person',
      weeklyCapacityHours: normalizeCapacityHours(person.weeklyCapacityHours),
    }))
    .sort(sortPeople);
  const validPersonIds = new Set(people.map((person) => person.id));
  const nonWorkingDates = Array.from(new Set(plan.nonWorkingDates.filter(normalizeIsoDate))).sort();
  const tasks = plan.tasks
    .map((task) => normalizeStoredTask(task, context, validPersonIds, nonWorkingDates))
    .filter((task): task is GanttBuilderTask => Boolean(task));

  return {
    people,
    tasks,
    nonWorkingDates,
    updatedAt: plan.updatedAt,
  };
}

export function createManualPerson(name: string): GanttBuilderPerson {
  return {
    id: `manual-person:${createId()}`,
    name: name.trim(),
    role: null,
    source: 'manual',
    weeklyCapacityHours: DEFAULT_WEEKLY_CAPACITY_HOURS,
  };
}

export function createTask(params: {
  title: string;
  estimateHours?: number;
  assigneeIds?: string[];
  role?: ProjectRole | null;
  startDate: string;
}): GanttBuilderTask {
  return {
    id: `task:${createId()}`,
    title: params.title.trim() || 'Untitled task',
    startDate: normalizeIsoDate(params.startDate) || new Date().toISOString().slice(0, 10),
    assignments: [
      createTaskAssignment({
        role: params.role ?? null,
        estimateHours: params.estimateHours ?? DEFAULT_TASK_ESTIMATE_HOURS,
        startDate: params.startDate,
        assigneeIds: params.assigneeIds ?? [],
      }),
    ],
  };
}

export function createTaskAssignment(params: {
  role?: ProjectRole | null;
  estimateHours?: number;
  startDate?: string;
  assigneeIds?: string[];
  personEstimates?: Record<string, number>;
  personStartDates?: Record<string, string>;
} = {}): GanttBuilderTaskAssignment {
  const estimateHours = normalizeEstimateHours(params.estimateHours ?? DEFAULT_TASK_ESTIMATE_HOURS);
  const assigneeIds = params.assigneeIds ?? [];
  const startDate =
    normalizeIsoDate(params.startDate ?? '') || new Date().toISOString().slice(0, 10);
  return {
    id: `assignment:${createId()}`,
    role: params.role ?? null,
    estimateHours,
    startDate,
    assigneeIds,
    personEstimates: buildNormalizedPersonEstimates(
      assigneeIds,
      estimateHours,
      params.personEstimates
    ),
    personStartDates: buildNormalizedPersonStartDates(
      assigneeIds,
      startDate,
      params.personStartDates
    ),
  };
}

export function parseBulkTasks(
  text: string,
  params: { assigneeIds: string[]; role: ProjectRole | null; startDate: string }
): GanttBuilderTask[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = parseBulkTaskLine(line);
      return createTask({
        title: parsed.title,
        estimateHours: parsed.estimateHours,
        assigneeIds: params.assigneeIds,
        role: params.role,
        startDate: params.startDate,
      });
    });
}

export function enumerateDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = toUtcDay(startDate);
  const end = toUtcDay(endDate);

  while (cursor <= end) {
    dates.push(fromUtcDay(cursor));
    cursor += 1;
  }

  return dates;
}

export function buildGanttBuilderCalendarDates(
  plan: GanttBuilderPlan,
  context: GanttBuilderContext
) {
  let endDate = context.period.end;

  for (const task of plan.tasks) {
    const taskEndDate = getTaskEndDate(task, plan.people, plan.nonWorkingDates);
    if (taskEndDate > endDate) {
      endDate = taskEndDate;
    }
  }

  return enumerateDates(context.period.start, endDate);
}

export function getTaskWorkDays(
  task: GanttBuilderTask,
  personOrPeople?: GanttBuilderPerson | GanttBuilderPerson[] | null
) {
  if (Array.isArray(personOrPeople)) {
    const peopleById = new Map(personOrPeople.map((person) => [person.id, person]));
    return Math.max(
      1,
      ...task.assignments.flatMap((assignment) => {
        const participantIds = assignment.assigneeIds.length > 0 ? assignment.assigneeIds : [null];
        return participantIds.map((personId) => {
          const person = personId ? peopleById.get(personId) : undefined;
          return getWorkDaysForHours(
            getAssignmentPersonHours(assignment, personId),
            getDailyCapacityHours(person)
          );
        });
      })
    );
  }

  return getWorkDaysForHours(getTaskTotalEstimateHours(task), getDailyCapacityHours(personOrPeople ?? undefined));
}

export function getTaskEndDate(
  task: GanttBuilderTask,
  personOrPeople?: GanttBuilderPerson | GanttBuilderPerson[] | null,
  nonWorkingDates: string[] = []
) {
  if (Array.isArray(personOrPeople)) {
    const peopleById = new Map(personOrPeople.map((person) => [person.id, person]));
    return task.assignments.reduce<string>((latest, assignment) => {
      const assignmentEnd = getAssignmentEndDate(assignment, peopleById, nonWorkingDates);
      return assignmentEnd > latest ? assignmentEnd : latest;
    }, task.startDate);
  }

  return task.assignments.reduce<string>((latest, assignment) => {
    const assignmentEnd = addWorkingDays(
      assignment.startDate,
      getWorkDaysForHours(assignment.estimateHours, getDailyCapacityHours(personOrPeople ?? undefined)),
      nonWorkingDates
    );
    return assignmentEnd > latest ? assignmentEnd : latest;
  }, task.startDate);
}

export function getAssignmentEndDate(
  assignment: GanttBuilderTaskAssignment,
  peopleById: Map<string, GanttBuilderPerson>,
  nonWorkingDates: string[] = []
) {
  const participantIds: (string | null)[] =
    assignment.assigneeIds.length > 0 ? assignment.assigneeIds : [null];
  return participantIds.reduce<string>((latest, personId) => {
    const person = personId ? peopleById.get(personId) : undefined;
    const endDate = addWorkingDays(
      getAssignmentPersonStartDate(assignment, personId),
      getWorkDaysForHours(getAssignmentPersonHours(assignment, personId), getDailyCapacityHours(person)),
      nonWorkingDates
    );
    return endDate > latest ? endDate : latest;
  }, assignment.startDate);
}

export function addWorkingDays(
  startDate: string,
  workDays: number,
  nonWorkingDates: string[] = []
) {
  let cursor = toUtcDay(nextWorkingDate(startDate, nonWorkingDates));
  let remaining = Math.max(1, workDays);

  while (true) {
    const date = fromUtcDay(cursor);
    if (isPlanWorkingDay(date, nonWorkingDates)) {
      remaining -= 1;
      if (remaining === 0) return date;
    }
    cursor += 1;
  }
}

export function nextWorkingDate(date: string, nonWorkingDates: string[] = []) {
  let cursor = toUtcDay(date);
  while (!isPlanWorkingDay(fromUtcDay(cursor), nonWorkingDates)) {
    cursor += 1;
  }
  return fromUtcDay(cursor);
}

export function isWorkingDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export function isPlanWorkingDay(date: string, nonWorkingDates: string[] = []) {
  return isWorkingDay(date) && !nonWorkingDates.includes(date);
}

export function getDailyCapacityHours(person?: GanttBuilderPerson) {
  return Math.max(1, (person?.weeklyCapacityHours ?? DEFAULT_WEEKLY_CAPACITY_HOURS) / 5);
}

export function buildCapacityWeekLoads(plan: GanttBuilderPlan) {
  const peopleById = new Map(plan.people.map((person) => [person.id, person]));
  const loadsByPerson = new Map<string, Map<string, number>>();

  for (const task of plan.tasks) {
    for (const entry of getTaskScheduleEntries(task, peopleById, plan.nonWorkingDates)) {
      if (!entry.personId) continue;
      const person = peopleById.get(entry.personId);
      if (!person) continue;

      const weekStart = getWeekStart(entry.date);
      const personLoads = loadsByPerson.get(person.id) ?? new Map<string, number>();
      personLoads.set(weekStart, roundHours((personLoads.get(weekStart) ?? 0) + entry.hours));
      loadsByPerson.set(person.id, personLoads);
    }
  }

  return Object.fromEntries(
    Array.from(loadsByPerson.entries()).map(([personId, weekMap]) => {
      const capacityHours =
        peopleById.get(personId)?.weeklyCapacityHours ?? DEFAULT_WEEKLY_CAPACITY_HOURS;

      return [
        personId,
        Array.from(weekMap.entries())
          .map(([weekStart, hours]) => ({
            weekStart,
            hours,
            capacityHours,
            overloaded: hours > capacityHours,
          }))
          .sort((left, right) => left.weekStart.localeCompare(right.weekStart)),
      ];
    })
  ) as Record<string, CapacityWeekLoad[]>;
}

export function getTaskScheduleEntries(
  task: GanttBuilderTask,
  peopleById: Map<string, GanttBuilderPerson>,
  nonWorkingDates: string[] = []
): GanttBuilderScheduleEntry[] {
  const entries: GanttBuilderScheduleEntry[] = [];

  for (const assignment of task.assignments) {
    const participantIds = assignment.assigneeIds.length > 0 ? assignment.assigneeIds : [null];

    for (const personId of participantIds) {
      const person = personId ? peopleById.get(personId) : undefined;
      let remaining = getAssignmentPersonHours(assignment, personId);
      let cursor = nextWorkingDate(getAssignmentPersonStartDate(assignment, personId), nonWorkingDates);
      const dailyCapacity = getDailyCapacityHours(person);

      while (remaining > 0) {
        if (isPlanWorkingDay(cursor, nonWorkingDates)) {
          const hours = Math.min(dailyCapacity, remaining);
          entries.push({
            taskId: task.id,
            assignmentId: assignment.id,
            date: cursor,
            personId,
            personName: person?.name ?? 'Unassigned',
            role: assignment.role,
            hours,
          });
          remaining = roundHours(remaining - hours);
        }
        cursor = addDays(cursor, 1);
      }
    }
  }

  return entries;
}

export function getTaskScheduledDates(
  task: GanttBuilderTask,
  personOrPeople?: GanttBuilderPerson | GanttBuilderPerson[] | Map<string, GanttBuilderPerson> | null,
  nonWorkingDates: string[] = []
) {
  let peopleById = new Map<string, GanttBuilderPerson>();
  if (personOrPeople instanceof Map) {
    peopleById = personOrPeople;
  } else if (Array.isArray(personOrPeople)) {
    peopleById = new Map(personOrPeople.map((person) => [person.id, person]));
  } else if (personOrPeople) {
    peopleById = new Map([[personOrPeople.id, personOrPeople]]);
  }

  return Array.from(
    new Set(getTaskScheduleEntries(task, peopleById, nonWorkingDates).map((entry) => entry.date))
  ).sort();
}

export function getTaskLaneHours(task: GanttBuilderTask, personId: string | null) {
  return task.assignments.reduce(
    (total, assignment) => total + getAssignmentPersonHours(assignment, personId),
    0
  );
}

export function getTaskTotalEstimateHours(task: GanttBuilderTask) {
  return roundHours(
    task.assignments.reduce((total, assignment) => {
      if (assignment.assigneeIds.length === 0) {
        return total + assignment.estimateHours;
      }

      return (
        total +
        assignment.assigneeIds.reduce(
          (assignmentTotal, personId) =>
            assignmentTotal + getAssignmentPersonHours(assignment, personId),
          0
        )
      );
    }, 0)
  );
}

export function getAssignmentPersonHours(
  assignment: GanttBuilderTaskAssignment,
  personId: string | null
) {
  if (personId === null) {
    return assignment.assigneeIds.length === 0 ? assignment.estimateHours : 0;
  }
  if (!assignment.assigneeIds.includes(personId)) return 0;
  return normalizeEstimateHours(assignment.personEstimates?.[personId] ?? assignment.estimateHours);
}

export function getAssignmentPersonStartDate(
  assignment: GanttBuilderTaskAssignment,
  personId: string | null
) {
  if (personId === null) return assignment.startDate;
  return assignment.personStartDates?.[personId] ?? assignment.startDate;
}

export function countPlanWorkingDaysBetween(
  startDate: string,
  endDate: string,
  nonWorkingDates: string[] = []
) {
  let count = 0;
  let cursor = toUtcDay(startDate);
  const end = toUtcDay(endDate);

  while (cursor <= end) {
    if (isPlanWorkingDay(fromUtcDay(cursor), nonWorkingDates)) {
      count += 1;
    }
    cursor += 1;
  }

  return Math.max(1, count);
}

export function getRoleLabel(role: ProjectRole | null) {
  if (!role) return 'No role';
  return PROJECT_ROLE_OPTIONS.find((option) => option.id === role)?.label ?? role;
}

export function normalizeEstimateHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TASK_ESTIMATE_HOURS;
  return Math.round(value * 4) / 4;
}

export function normalizeCapacityHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WEEKLY_CAPACITY_HOURS;
  return Math.round(value * 4) / 4;
}

function buildPeopleFromReport(report: ReportResult): GanttBuilderPerson[] {
  return report.people
    .map((person) => ({
      id: person.userId,
      name: person.userName,
      role: null,
      source: 'gitlab' as const,
      weeklyCapacityHours: DEFAULT_WEEKLY_CAPACITY_HOURS,
    }))
    .sort(sortPeople);
}

function parseBulkTaskLine(line: string) {
  const estimatePatterns = [
    /^\[(\d+(?:[.,]\d+)?)\s*h(?:ours?)?\]\s*(.+)$/i,
    /^(.+?)\s*[|;]\s*(\d+(?:[.,]\d+)?)\s*h(?:ours?)?$/i,
    /^(.+?)\s+-\s+(\d+(?:[.,]\d+)?)\s*h(?:ours?)?$/i,
    /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*h(?:ours?)?$/i,
  ];

  for (const pattern of estimatePatterns) {
    const match = line.match(pattern);
    if (!match) continue;

    if (pattern === estimatePatterns[0]) {
      return {
        title: match[2].trim(),
        estimateHours: parseNumber(match[1]),
      };
    }

    return {
      title: match[1].trim(),
      estimateHours: parseNumber(match[2]),
    };
  }

  return {
    title: line,
    estimateHours: DEFAULT_TASK_ESTIMATE_HOURS,
  };
}

function normalizeStoredTask(
  value: unknown,
  context: GanttBuilderContext,
  validPersonIds: Set<string>,
  nonWorkingDates: string[]
): GanttBuilderTask | null {
  if (!value || typeof value !== 'object') return null;
  const task = value as {
    id?: unknown;
    title?: unknown;
    startDate?: unknown;
    assignments?: unknown;
    estimateHours?: unknown;
    assigneeId?: unknown;
  };

  if (typeof task.id !== 'string' || typeof task.title !== 'string') {
    return null;
  }

  const assignments = Array.isArray(task.assignments)
    ? task.assignments
        .map((assignment) =>
          normalizeStoredAssignment(
            assignment,
            validPersonIds,
            typeof task.startDate === 'string' && normalizeIsoDate(task.startDate)
              ? task.startDate
              : context.period.start,
            nonWorkingDates
          )
        )
        .filter((assignment): assignment is GanttBuilderTaskAssignment => Boolean(assignment))
    : [
        createTaskAssignment({
          estimateHours:
            typeof task.estimateHours === 'number'
              ? task.estimateHours
              : DEFAULT_TASK_ESTIMATE_HOURS,
          assigneeIds:
            typeof task.assigneeId === 'string' && validPersonIds.has(task.assigneeId)
              ? [task.assigneeId]
              : [],
          startDate:
            typeof task.startDate === 'string' && normalizeIsoDate(task.startDate)
              ? task.startDate
              : context.period.start,
        }),
      ];

  return {
    id: task.id,
    title: task.title.trim() || 'Untitled task',
    startDate: nextWorkingDate(
      typeof task.startDate === 'string' && normalizeIsoDate(task.startDate)
        ? task.startDate
        : context.period.start,
      nonWorkingDates
    ),
    assignments: assignments.length > 0 ? assignments : [createTaskAssignment()],
  };
}

function normalizeStoredAssignment(
  value: unknown,
  validPersonIds: Set<string>,
  fallbackStartDate: string,
  nonWorkingDates: string[]
): GanttBuilderTaskAssignment | null {
  if (!value || typeof value !== 'object') return null;
  const assignment = value as {
    id?: unknown;
    role?: unknown;
    estimateHours?: unknown;
    startDate?: unknown;
    assigneeIds?: unknown;
    personEstimates?: unknown;
    personStartDates?: unknown;
  };

  const assigneeIds = Array.isArray(assignment.assigneeIds)
    ? Array.from(
        new Set(
          assignment.assigneeIds.filter(
            (personId): personId is string =>
              typeof personId === 'string' && validPersonIds.has(personId)
          )
        )
      )
    : [];
  const estimateHours =
    typeof assignment.estimateHours === 'number'
      ? normalizeEstimateHours(assignment.estimateHours)
      : DEFAULT_TASK_ESTIMATE_HOURS;

  return {
    id: typeof assignment.id === 'string' ? assignment.id : `assignment:${createId()}`,
    role:
      assignment.role === null || PROJECT_ROLE_OPTIONS.some((role) => role.id === assignment.role)
        ? (assignment.role as ProjectRole | null)
        : null,
    estimateHours,
    startDate: nextWorkingDate(
      typeof assignment.startDate === 'string' && normalizeIsoDate(assignment.startDate)
        ? assignment.startDate
        : fallbackStartDate,
      nonWorkingDates
    ),
    assigneeIds,
    personEstimates: buildNormalizedPersonEstimates(
      assigneeIds,
      estimateHours,
      isStoredPersonEstimates(assignment.personEstimates) ? assignment.personEstimates : undefined
    ),
    personStartDates: buildNormalizedPersonStartDates(
      assigneeIds,
      typeof assignment.startDate === 'string' && normalizeIsoDate(assignment.startDate)
        ? assignment.startDate
        : fallbackStartDate,
      isStoredPersonStartDates(assignment.personStartDates) ? assignment.personStartDates : undefined
    ),
  };
}

function isStoredPerson(value: unknown): value is GanttBuilderPerson {
  if (!value || typeof value !== 'object') return false;
  const person = value as Partial<GanttBuilderPerson>;
  return (
    typeof person.id === 'string' &&
    typeof person.name === 'string' &&
    (person.role === null || PROJECT_ROLE_OPTIONS.some((role) => role.id === person.role)) &&
    (person.source === 'gitlab' || person.source === 'manual') &&
    typeof person.weeklyCapacityHours === 'number'
  );
}

function isStoredPersonEstimates(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every((hours) => typeof hours === 'number');
}

function isStoredPersonStartDates(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every((date) => typeof date === 'string');
}

function buildNormalizedPersonEstimates(
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

function buildNormalizedPersonStartDates(
  assigneeIds: string[],
  fallbackStartDate: string,
  personStartDates?: Record<string, string>
) {
  if (assigneeIds.length === 0) return undefined;

  return Object.fromEntries(
    assigneeIds.map((personId) => [
      personId,
      normalizeIsoDate(personStartDates?.[personId] ?? '') || fallbackStartDate,
    ])
  );
}

function normalizeIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function getWorkDaysForHours(hours: number, dailyCapacityHours: number) {
  return Math.max(1, Math.ceil(hours / Math.max(1, dailyCapacityHours)));
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseNumber(value: string) {
  return Number(value.replace(',', '.'));
}

function sortPeople(left: GanttBuilderPerson, right: GanttBuilderPerson) {
  if (left.source !== right.source) {
    return left.source === 'gitlab' ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function getWeekStart(date: string) {
  const cursor = toUtcDay(date);
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return fromUtcDay(cursor + mondayOffset);
}

function addDays(date: string, days: number) {
  return fromUtcDay(toUtcDay(date) + days);
}

function toUtcDay(date: string) {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86400000);
}

function fromUtcDay(day: number) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}
