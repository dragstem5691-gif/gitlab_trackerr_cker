import type { FilterFormValues, ReportResult } from '../types';
import type { PlanningAssignments } from './planning';

const WORKSPACE_VERSION = 1;
const WORKSPACE_KIND = 'gtr-workspace';
const GANTT_BUILDER_PREFIX = 'gtr.ganttBuilder';
const FORM_KEYS_TO_IGNORE = new Set(['token']);

export interface WorkspaceSnapshot {
  version: number;
  kind: typeof WORKSPACE_KIND;
  exportedAt: string;
  form: Omit<FilterFormValues, 'token'>;
  report: ReportResult | null;
  planningAssignments: PlanningAssignments;
  ganttBuilderPlans: Record<string, unknown>;
}

export interface WorkspaceCaptureInput {
  form: FilterFormValues;
  report: ReportResult | null;
  planningAssignments: PlanningAssignments;
}

export function captureWorkspace(input: WorkspaceCaptureInput): WorkspaceSnapshot {
  const ganttBuilderPlans: Record<string, unknown> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(GANTT_BUILDER_PREFIX)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      ganttBuilderPlans[key] = JSON.parse(raw);
    } catch {
      ganttBuilderPlans[key] = raw;
    }
  }

  const formEntries = Object.entries(input.form).filter(([key]) => !FORM_KEYS_TO_IGNORE.has(key));
  const sanitizedForm = Object.fromEntries(formEntries) as Omit<FilterFormValues, 'token'>;

  return {
    version: WORKSPACE_VERSION,
    kind: WORKSPACE_KIND,
    exportedAt: new Date().toISOString(),
    form: sanitizedForm,
    report: input.report,
    planningAssignments: input.planningAssignments,
    ganttBuilderPlans,
  };
}

export function serializeWorkspace(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function parseWorkspace(source: string): WorkspaceSnapshot {
  const parsed = JSON.parse(source) as Partial<WorkspaceSnapshot>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid workspace file.');
  }
  if (parsed.kind !== WORKSPACE_KIND) {
    throw new Error(`Unexpected workspace kind: ${String(parsed.kind)}`);
  }
  if (typeof parsed.version !== 'number' || parsed.version > WORKSPACE_VERSION) {
    throw new Error(`Unsupported workspace version: ${String(parsed.version)}`);
  }

  return {
    version: parsed.version,
    kind: WORKSPACE_KIND,
    exportedAt: String(parsed.exportedAt ?? new Date().toISOString()),
    form: (parsed.form ?? {}) as Omit<FilterFormValues, 'token'>,
    report: (parsed.report as ReportResult | null) ?? null,
    planningAssignments: (parsed.planningAssignments ?? {}) as PlanningAssignments,
    ganttBuilderPlans:
      parsed.ganttBuilderPlans && typeof parsed.ganttBuilderPlans === 'object'
        ? (parsed.ganttBuilderPlans as Record<string, unknown>)
        : {},
  };
}

export function applyGanttBuilderPlans(plans: Record<string, unknown>) {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(GANTT_BUILDER_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
  for (const [key, value] of Object.entries(plans)) {
    if (!key.startsWith(GANTT_BUILDER_PREFIX)) continue;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
  }
}

export function buildWorkspaceFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}`;
  return `gtr-workspace-${stamp}.json`;
}

export function downloadWorkspaceFile(snapshot: WorkspaceSnapshot): void {
  const blob = new Blob([serializeWorkspace(snapshot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildWorkspaceFilename();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
