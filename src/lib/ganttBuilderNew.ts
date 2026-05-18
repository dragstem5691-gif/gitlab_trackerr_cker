import {
  buildCapacityWeekLoads,
  createGanttBuilderContext,
  createInitialGanttBuilderPlan,
  getGanttBuilderStorageKey,
  getTaskEndDate,
  getTaskTotalEstimateHours,
  loadGanttBuilderPlan,
  normalizePlanForReport,
  type GanttBuilderContext,
  type GanttBuilderPlan,
} from './ganttBuilder';
import type { ReportResult } from '../types';

export type GanttBuilderNewZoom = 'hours' | 'day' | 'week' | 'month';
export type GanttBuilderNewPanel = 'plan' | 'workload' | 'conflicts';

export interface GanttBuilderNewViewSettings {
  zoom: GanttBuilderNewZoom;
  panel: GanttBuilderNewPanel;
  showWeekends: boolean;
}

export interface GanttBuilderNewDocument {
  version: 1;
  kind: 'gantt-builder-new-plan';
  createdAt: string;
  updatedAt: string;
  source: 'manual' | 'old-import' | 'gitlab-import';
  oldPlanStorageKey?: string;
  plan: GanttBuilderPlan;
  view: GanttBuilderNewViewSettings;
}

export interface GanttBuilderNewConflict {
  id: string;
  severity: 'warning' | 'info';
  type:
    | 'overload'
    | 'unassigned'
    | 'outside-period'
    | 'gitlab-closed-future'
    | 'gitlab-open-past'
    | 'gitlab-assignees'
    | 'gitlab-no-estimate'
    | 'gitlab-spent-over-estimate';
  message: string;
  reference?: string;
  taskId?: string;
}

const STORAGE_PREFIX = 'gtr.ganttBuilderNew';

export const DEFAULT_GANTT_BUILDER_NEW_VIEW: GanttBuilderNewViewSettings = {
  zoom: 'week',
  panel: 'plan',
  showWeekends: true,
};

export function createGanttBuilderNewContext(report?: ReportResult | null) {
  return createGanttBuilderContext(report ?? undefined);
}

export function getGanttBuilderNewStorageKey(context: GanttBuilderContext) {
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

export function createGanttBuilderNewDocument(
  context: GanttBuilderContext,
  options: {
    source?: GanttBuilderNewDocument['source'];
    plan?: GanttBuilderPlan;
    oldPlanStorageKey?: string;
  } = {}
): GanttBuilderNewDocument {
  const now = new Date().toISOString();
  const plan = options.plan ?? createInitialGanttBuilderPlan(context);

  return {
    version: 1,
    kind: 'gantt-builder-new-plan',
    createdAt: now,
    updatedAt: now,
    source: options.source ?? 'manual',
    oldPlanStorageKey: options.oldPlanStorageKey,
    plan: normalizePlanForReport(plan, context),
    view: DEFAULT_GANTT_BUILDER_NEW_VIEW,
  };
}

export function loadGanttBuilderNewDocument(context: GanttBuilderContext) {
  const key = getGanttBuilderNewStorageKey(context);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GanttBuilderNewDocument>;
    if (parsed.kind !== 'gantt-builder-new-plan' || !parsed.plan) return null;

    return {
      version: 1,
      kind: 'gantt-builder-new-plan',
      createdAt: String(parsed.createdAt ?? new Date().toISOString()),
      updatedAt: String(parsed.updatedAt ?? new Date().toISOString()),
      source: parsed.source ?? 'manual',
      oldPlanStorageKey: parsed.oldPlanStorageKey,
      plan: normalizePlanForReport(parsed.plan, context),
      view: {
        ...DEFAULT_GANTT_BUILDER_NEW_VIEW,
        ...(parsed.view ?? {}),
      },
    } satisfies GanttBuilderNewDocument;
  } catch {
    return null;
  }
}

export function saveGanttBuilderNewDocument(
  context: GanttBuilderContext,
  document: GanttBuilderNewDocument
) {
  const nextDocument: GanttBuilderNewDocument = {
    ...document,
    updatedAt: new Date().toISOString(),
    plan: {
      ...document.plan,
      updatedAt: new Date().toISOString(),
    },
  };
  window.localStorage.setItem(getGanttBuilderNewStorageKey(context), JSON.stringify(nextDocument));
  return nextDocument;
}

export function getOldGanttBuilderPlanInfo(context: GanttBuilderContext) {
  const key = getGanttBuilderStorageKey(context);
  return {
    key,
    exists: window.localStorage.getItem(key) !== null,
  };
}

export function importOldGanttBuilderPlan(context: GanttBuilderContext) {
  const oldPlan = loadGanttBuilderPlan(context);
  const oldInfo = getOldGanttBuilderPlanInfo(context);
  return createGanttBuilderNewDocument(context, {
    source: 'old-import',
    plan: oldPlan,
    oldPlanStorageKey: oldInfo.key,
  });
}

export function buildGanttBuilderNewConflicts(
  document: GanttBuilderNewDocument,
  context: GanttBuilderContext
): GanttBuilderNewConflict[] {
  const conflicts: GanttBuilderNewConflict[] = [];
  const { plan } = document;
  const today = new Date().toISOString().slice(0, 10);
  const peopleById = new Map(plan.people.map((person) => [person.id, person]));

  for (const [personId, loads] of Object.entries(buildCapacityWeekLoads(plan))) {
    const person = peopleById.get(personId);
    for (const load of loads) {
      if (!load.overloaded) continue;
      conflicts.push({
        id: `overload:${personId}:${load.weekStart}`,
        severity: 'warning',
        type: 'overload',
        message: `${person?.name ?? 'Unknown person'} is over capacity for week ${load.weekStart}: ${load.hours}/${load.capacityHours}h.`,
        reference: person?.name,
      });
    }
  }

  for (const task of plan.tasks) {
    const taskEndDate = getTaskEndDate(task, plan.people, plan.nonWorkingDates);
    const taskRef = task.issueProjectPath && task.issueIid
      ? `${task.issueProjectPath}#${task.issueIid}`
      : task.title;

    if (task.assignments.some((assignment) => assignment.assigneeIds.length === 0)) {
      conflicts.push({
        id: `${task.id}:unassigned`,
        severity: 'info',
        type: 'unassigned',
        message: `Task has unassigned work.`,
        reference: taskRef,
        taskId: task.id,
      });
    }

    if (task.startDate < context.period.start || taskEndDate > context.period.end) {
      conflicts.push({
        id: `${task.id}:outside-period`,
        severity: 'warning',
        type: 'outside-period',
        message: `Task is planned outside the selected beta period.`,
        reference: taskRef,
        taskId: task.id,
      });
    }

    if (task.source !== 'gitlab') continue;

    if (task.gitlabState === 'closed' && taskEndDate > today) {
      conflicts.push({
        id: `${task.id}:closed-future`,
        severity: 'warning',
        type: 'gitlab-closed-future',
        message: `Closed in GitLab but planned into the future.`,
        reference: taskRef,
        taskId: task.id,
      });
    }

    if (task.gitlabState !== 'closed' && taskEndDate < today) {
      conflicts.push({
        id: `${task.id}:open-past`,
        severity: 'warning',
        type: 'gitlab-open-past',
        message: `Still open in GitLab but the beta plan ends before today.`,
        reference: taskRef,
        taskId: task.id,
      });
    }

    const plannedAssignees = new Set(
      task.assignments.flatMap((assignment) => assignment.assigneeIds)
    );
    const gitlabAssignees = new Set(task.gitlabAssigneeIds ?? []);
    if (!setsEqual(plannedAssignees, gitlabAssignees)) {
      conflicts.push({
        id: `${task.id}:assignees`,
        severity: 'warning',
        type: 'gitlab-assignees',
        message: `Local assignees differ from GitLab assignees.`,
        reference: taskRef,
        taskId: task.id,
      });
    }

    if (task.gitlabTimeEstimateHours === 0 || getTaskTotalEstimateHours(task) <= 0) {
      conflicts.push({
        id: `${task.id}:no-estimate`,
        severity: 'info',
        type: 'gitlab-no-estimate',
        message: `Task has no GitLab time estimate.`,
        reference: taskRef,
        taskId: task.id,
      });
    }

    if (
      task.gitlabTimeEstimateHours !== undefined &&
      task.gitlabSpentHours !== undefined &&
      task.gitlabTimeEstimateHours > 0 &&
      task.gitlabSpentHours > task.gitlabTimeEstimateHours
    ) {
      conflicts.push({
        id: `${task.id}:spent-over-estimate`,
        severity: 'warning',
        type: 'gitlab-spent-over-estimate',
        message: `Spent time is already above GitLab estimate.`,
        reference: taskRef,
        taskId: task.id,
      });
    }
  }

  return conflicts;
}

function setsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
