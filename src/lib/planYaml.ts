import type {
  GanttBuilderPlan,
  GanttBuilderPerson,
  GanttBuilderTask,
  GanttBuilderTaskAssignment,
} from './ganttBuilder';

const INDENT = '  ';

function needsQuote(value: string) {
  if (value === '') return true;
  if (/^(true|false|null|yes|no|on|off)$/i.test(value)) return true;
  if (/^-?\d+(\.\d+)?$/.test(value)) return true;
  if (/[:#\-?&*!|>'"`%@,\[\]{}\n\r\t]/.test(value)) return true;
  if (/^\s|\s$/.test(value)) return true;
  return false;
}

function quote(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const str = String(value);
  return needsQuote(str) ? quote(str) : str;
}

function formatList(values: unknown[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map((value) => formatScalar(value)).join(', ')}]`;
}

function writeKeyValue(key: string, value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}${key}: []`;
    const scalars = value.every(
      (item) =>
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
    );
    if (scalars) return `${indent}${key}: ${formatList(value)}`;
    const lines = [`${indent}${key}:`];
    for (const item of value) {
      lines.push(...writeListItem(item, indent));
    }
    return lines.join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${indent}${key}: {}`;
    const lines = [`${indent}${key}:`];
    for (const [subKey, subValue] of entries) {
      lines.push(writeKeyValue(subKey, subValue, indent + INDENT));
    }
    return lines.join('\n');
  }
  return `${indent}${key}: ${formatScalar(value)}`;
}

function writeListItem(value: unknown, indent: string): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${indent}- {}`];
    const [firstKey, firstValue] = entries[0];
    const firstLine = writeKeyValue(firstKey, firstValue, '').split('\n');
    const lines = [`${indent}- ${firstLine[0]}`];
    for (const extra of firstLine.slice(1)) {
      lines.push(`${indent}${INDENT}${extra}`);
    }
    for (const [subKey, subValue] of entries.slice(1)) {
      lines.push(writeKeyValue(subKey, subValue, indent + INDENT));
    }
    return lines;
  }
  return [`${indent}- ${formatScalar(value)}`];
}

export interface PlanYamlMeta {
  projectPath: string;
  periodStart: string;
  periodEnd: string;
}

export function serializePlanToYaml(plan: GanttBuilderPlan, meta: PlanYamlMeta): string {
  const doc: Record<string, unknown> = {
    version: 1,
    kind: 'gantt-builder-plan',
    exportedAt: new Date().toISOString(),
    projectPath: meta.projectPath,
    period: { start: meta.periodStart, end: meta.periodEnd },
    updatedAt: plan.updatedAt,
    extraCalendarDays: plan.extraCalendarDays ?? 0,
    nonWorkingDates: plan.nonWorkingDates,
    people: plan.people.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      source: person.source,
      weeklyCapacityHours: person.weeklyCapacityHours,
    })),
    tasks: plan.tasks.map((task) => serializeTask(task)),
  };

  const lines: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    lines.push(writeKeyValue(key, value, ''));
  }
  return `${lines.join('\n')}\n`;
}

function serializeTask(task: GanttBuilderTask): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    startDate: task.startDate,
  };
  if (task.order !== undefined) record.order = task.order;
  if (task.source) record.source = task.source;
  if (task.issueId) record.issueId = task.issueId;
  if (task.issueIid) record.issueIid = task.issueIid;
  if (task.issueWebUrl) record.issueWebUrl = task.issueWebUrl;
  if (task.issueProjectPath) record.issueProjectPath = task.issueProjectPath;
  if (task.gitlabState) record.gitlabState = task.gitlabState;
  if (task.gitlabClosedAt !== undefined) record.gitlabClosedAt = task.gitlabClosedAt;
  if (task.gitlabDueDate !== undefined) record.gitlabDueDate = task.gitlabDueDate;
  if (task.gitlabUpdatedAt) record.gitlabUpdatedAt = task.gitlabUpdatedAt;
  if (task.gitlabLabels) record.gitlabLabels = task.gitlabLabels;
  if (task.gitlabMilestoneTitle !== undefined)
    record.gitlabMilestoneTitle = task.gitlabMilestoneTitle;
  if (task.gitlabAssigneeIds) record.gitlabAssigneeIds = task.gitlabAssigneeIds;
  if (task.gitlabAssigneeNames) record.gitlabAssigneeNames = task.gitlabAssigneeNames;
  if (task.gitlabTimeEstimateHours !== undefined)
    record.gitlabTimeEstimateHours = task.gitlabTimeEstimateHours;
  if (task.gitlabSpentHours !== undefined) record.gitlabSpentHours = task.gitlabSpentHours;

  record.assignments = task.assignments.map((assignment) => serializeAssignment(assignment));
  return record;
}

function serializeAssignment(
  assignment: GanttBuilderTaskAssignment
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: assignment.id,
    role: assignment.role,
    estimateHours: assignment.estimateHours,
    startDate: assignment.startDate,
    assigneeIds: assignment.assigneeIds,
  };
  if (assignment.personEstimates && Object.keys(assignment.personEstimates).length > 0) {
    record.personEstimates = assignment.personEstimates;
  }
  if (assignment.personStartDates && Object.keys(assignment.personStartDates).length > 0) {
    record.personStartDates = assignment.personStartDates;
  }
  return record;
}

// Minimal YAML parser supporting the subset we emit
interface Line {
  indent: number;
  raw: string;
  text: string;
}

function tokenize(source: string): Line[] {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw) => {
      const indent = raw.match(/^ */)![0].length;
      const text = raw.trim();
      return { indent, raw, text };
    })
    .filter((line) => line.text.length > 0 && !line.text.startsWith('#'));
}

function parseScalar(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed === 'null' || trimmed === '~' || trimmed === '') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlowList(inner).map(parseScalar);
  }
  return trimmed;
}

function splitFlowList(input: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  let inQuote: '"' | "'" | null = null;
  for (const ch of input) {
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function parseBlock(lines: Line[], start: number, indent: number): { value: unknown; next: number } {
  if (start >= lines.length || lines[start].indent < indent) {
    return { value: null, next: start };
  }
  const first = lines[start];
  if (first.text.startsWith('- ')) {
    const list: unknown[] = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
      const itemLine = lines[i];
      const afterDash = itemLine.text.slice(2).trim();
      if (afterDash.includes(':') && !afterDash.startsWith('"') && !afterDash.startsWith('[')) {
        const virtualLines: Line[] = [
          { indent: indent + 2, raw: afterDash, text: afterDash },
        ];
        let j = i + 1;
        while (j < lines.length && lines[j].indent > indent) {
          virtualLines.push(lines[j]);
          j += 1;
        }
        const { value } = parseBlock(virtualLines, 0, indent + 2);
        list.push(value);
        i = j;
      } else {
        list.push(parseScalar(afterDash));
        i += 1;
      }
    }
    return { value: list, next: i };
  }

  const map: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    const colonIndex = line.text.indexOf(':');
    if (colonIndex === -1) break;
    const key = line.text.slice(0, colonIndex).trim();
    const rest = line.text.slice(colonIndex + 1).trim();
    if (rest === '') {
      const { value, next } = parseBlock(lines, i + 1, indent + 2);
      map[key] = value;
      i = next;
    } else {
      map[key] = parseScalar(rest);
      i += 1;
    }
  }
  return { value: map, next: i };
}

export interface ParsedPlanDocument {
  plan: GanttBuilderPlan;
  meta: PlanYamlMeta;
}

export function parsePlanFromYaml(source: string): ParsedPlanDocument {
  const lines = tokenize(source);
  const { value } = parseBlock(lines, 0, 0);
  const doc = value as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid YAML plan document');
  }
  if (doc.kind && doc.kind !== 'gantt-builder-plan') {
    throw new Error(`Unsupported YAML kind: ${String(doc.kind)}`);
  }

  const period = (doc.period ?? {}) as Record<string, unknown>;
  const meta: PlanYamlMeta = {
    projectPath: String(doc.projectPath ?? ''),
    periodStart: String(period.start ?? ''),
    periodEnd: String(period.end ?? ''),
  };

  const people = Array.isArray(doc.people) ? (doc.people as unknown[]).map(toPerson) : [];
  const tasks = Array.isArray(doc.tasks) ? (doc.tasks as unknown[]).map(toTask) : [];
  const nonWorkingDates = Array.isArray(doc.nonWorkingDates)
    ? (doc.nonWorkingDates as unknown[]).map(String)
    : [];

  const plan: GanttBuilderPlan = {
    people,
    tasks,
    nonWorkingDates,
    updatedAt: String(doc.updatedAt ?? new Date().toISOString()),
    extraCalendarDays:
      typeof doc.extraCalendarDays === 'number' && doc.extraCalendarDays > 0
        ? Math.floor(doc.extraCalendarDays as number)
        : undefined,
  };
  return { plan, meta };
}

function toPerson(input: unknown): GanttBuilderPerson {
  const obj = (input ?? {}) as Record<string, unknown>;
  return {
    id: String(obj.id ?? ''),
    name: String(obj.name ?? ''),
    role: (obj.role as GanttBuilderPerson['role']) ?? null,
    source: (obj.source as GanttBuilderPerson['source']) ?? 'manual',
    weeklyCapacityHours: Number(obj.weeklyCapacityHours ?? 40),
  };
}

function toTask(input: unknown): GanttBuilderTask {
  const obj = (input ?? {}) as Record<string, unknown>;
  const assignments = Array.isArray(obj.assignments)
    ? (obj.assignments as unknown[]).map(toAssignment)
    : [];
  const task: GanttBuilderTask = {
    id: String(obj.id ?? ''),
    title: String(obj.title ?? ''),
    startDate: String(obj.startDate ?? ''),
    assignments,
  };
  if (obj.order !== undefined && obj.order !== null) task.order = Number(obj.order);
  if (obj.source) task.source = obj.source as GanttBuilderTask['source'];
  if (obj.issueId !== undefined && obj.issueId !== null) task.issueId = String(obj.issueId);
  if (obj.issueIid !== undefined && obj.issueIid !== null) task.issueIid = String(obj.issueIid);
  if (obj.issueWebUrl) task.issueWebUrl = String(obj.issueWebUrl);
  if (obj.issueProjectPath) task.issueProjectPath = String(obj.issueProjectPath);
  if (obj.gitlabState) task.gitlabState = String(obj.gitlabState);
  if (obj.gitlabClosedAt !== undefined)
    task.gitlabClosedAt = obj.gitlabClosedAt === null ? null : String(obj.gitlabClosedAt);
  if (obj.gitlabDueDate !== undefined)
    task.gitlabDueDate = obj.gitlabDueDate === null ? null : String(obj.gitlabDueDate);
  if (obj.gitlabUpdatedAt) task.gitlabUpdatedAt = String(obj.gitlabUpdatedAt);
  if (Array.isArray(obj.gitlabLabels))
    task.gitlabLabels = (obj.gitlabLabels as unknown[]).map(String);
  if (obj.gitlabMilestoneTitle !== undefined)
    task.gitlabMilestoneTitle =
      obj.gitlabMilestoneTitle === null ? null : String(obj.gitlabMilestoneTitle);
  if (Array.isArray(obj.gitlabAssigneeIds))
    task.gitlabAssigneeIds = (obj.gitlabAssigneeIds as unknown[]).map(String);
  if (Array.isArray(obj.gitlabAssigneeNames))
    task.gitlabAssigneeNames = (obj.gitlabAssigneeNames as unknown[]).map(String);
  if (obj.gitlabTimeEstimateHours !== undefined)
    task.gitlabTimeEstimateHours = Number(obj.gitlabTimeEstimateHours);
  if (obj.gitlabSpentHours !== undefined) task.gitlabSpentHours = Number(obj.gitlabSpentHours);
  return task;
}

function toAssignment(input: unknown): GanttBuilderTaskAssignment {
  const obj = (input ?? {}) as Record<string, unknown>;
  const assignment: GanttBuilderTaskAssignment = {
    id: String(obj.id ?? ''),
    role: (obj.role as GanttBuilderTaskAssignment['role']) ?? null,
    estimateHours: Number(obj.estimateHours ?? 0),
    startDate: String(obj.startDate ?? ''),
    assigneeIds: Array.isArray(obj.assigneeIds)
      ? (obj.assigneeIds as unknown[]).map(String)
      : [],
  };
  if (obj.personEstimates && typeof obj.personEstimates === 'object') {
    const entries = Object.entries(obj.personEstimates as Record<string, unknown>);
    assignment.personEstimates = Object.fromEntries(
      entries.map(([key, value]) => [key, Number(value)])
    );
  }
  if (obj.personStartDates && typeof obj.personStartDates === 'object') {
    const entries = Object.entries(obj.personStartDates as Record<string, unknown>);
    assignment.personStartDates = Object.fromEntries(
      entries.map(([key, value]) => [key, String(value)])
    );
  }
  return assignment;
}
