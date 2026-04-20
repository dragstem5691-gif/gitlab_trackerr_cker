import type { CellValue, Worksheet } from 'exceljs';
import type { ReportResult } from '../types';
import {
  PLANNING_EXPORT_COLUMNS,
  buildPlanningAssignedPeople,
  buildPlanningBoards,
  buildPlanningTaskRows,
  getProjectRoleLabel,
  sumPlanningTaskHours,
  type PlanningAssignments,
  type PlanningTaskHours,
  type PlanningTaskRow,
  type ProjectRole,
} from './planning';

const PLANNING_TEMPLATE_URL = new URL('../../Planning example.xlsx', import.meta.url).href;
const EXPORT_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_TEMPLATE_COLUMNS = 9;

const EMPLOYEE_TEMPLATE_ROW_BY_ROLE: Record<ProjectRole, number> = {
  leadPm: 2,
  pm: 3,
  analytic: 4,
  lead: 5,
  backend: 6,
  frontend: 8,
  designer: 10,
};

const TASK_COLUMN_BY_EXPORT_COLUMN = {
  pmAnalytic: 3,
  leadPm: 4,
  lead: 5,
  backend: 6,
  frontend: 7,
  designer: 8,
} as const;

interface RowTemplate {
  height?: number;
  cells: { style: Record<string, unknown>; value: CellValue | null }[];
}

export async function downloadPlanningWorkbook(
  report: ReportResult,
  assignments: PlanningAssignments
) {
  const buffer = await buildPlanningWorkbookBuffer(report, assignments);
  const blob = new Blob([buffer], { type: EXPORT_MIME });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = makePlanningFileName(report.projectPath, report.period.start, report.period.end);
  anchor.click();

  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

async function buildPlanningWorkbookBuffer(
  report: ReportResult,
  assignments: PlanningAssignments
) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const templateWorkbook = new ExcelJS.Workbook();
  const templateResponse = await fetch(PLANNING_TEMPLATE_URL);

  if (!templateResponse.ok) {
    throw new Error(`Failed to load planning template: ${templateResponse.status}`);
  }

  const templateBuffer = await templateResponse.arrayBuffer();
  await templateWorkbook.xlsx.load(templateBuffer);

  const templateSheet =
    resolveActiveTemplateSheet(templateWorkbook) ??
    templateWorkbook.worksheets[templateWorkbook.worksheets.length - 1];
  if (!templateSheet) {
    throw new Error('Planning template does not contain any worksheets');
  }

  workbook.creator = 'GitLab Time Tracking Report';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet(
    makePlanningSheetName(report.period.start, report.period.end)
  );

  applyWorksheetTemplate(sheet, templateSheet);

  const rowTemplates = {
    header: captureRowTemplate(templateSheet, 1),
    employeeTotal: captureRowTemplate(templateSheet, 11),
    spacer: captureRowTemplate(templateSheet, 12),
    sectionLabel: captureRowTemplate(templateSheet, 13),
    taskHeader: captureRowTemplate(templateSheet, 14),
    taskRoot: captureRowTemplate(templateSheet, 15),
    taskChild: captureRowTemplate(templateSheet, 16),
    taskTotal: captureRowTemplate(templateSheet, 52),
    employeeByRole: Object.fromEntries(
      Object.entries(EMPLOYEE_TEMPLATE_ROW_BY_ROLE).map(([role, rowNumber]) => [
        role,
        captureRowTemplate(templateSheet, rowNumber),
      ])
    ) as Record<ProjectRole, RowTemplate>,
  };

  const boards = buildPlanningBoards(report);
  const assignedPeople = buildPlanningAssignedPeople(boards, assignments);
  const taskRows = buildPlanningTaskRows(report, assignments);
  const taskTotals = sumPlanningTaskHours(taskRows);

  populateHeaderRow(sheet, rowTemplates.header);
  const layout = populateBody(sheet, {
    rowTemplates,
    assignedPeople,
    taskRows,
    taskTotals,
  });

  verifyTaskTreeExport(sheet, layout.taskStartRow, taskRows);

  return workbook.xlsx.writeBuffer();
}

function resolveActiveTemplateSheet(workbook: import('exceljs').Workbook) {
  const activeTab = workbook.views?.[0]?.activeTab;
  if (typeof activeTab === 'number' && activeTab >= 0) {
    return workbook.worksheets[activeTab];
  }

  return undefined;
}

function applyWorksheetTemplate(
  target: Worksheet,
  source: Worksheet
) {
  target.state = source.state;
  target.views = cloneJson(source.views) || [];

  if (source.pageSetup) {
    target.pageSetup = cloneJson(source.pageSetup);
  }
  if (source.headerFooter) {
    target.headerFooter = cloneJson(source.headerFooter);
  }

  target.properties.defaultRowHeight = source.properties.defaultRowHeight;
  if (source.properties.defaultColWidth) {
    target.properties.defaultColWidth = source.properties.defaultColWidth;
  }

  for (let columnIndex = 1; columnIndex <= MAX_TEMPLATE_COLUMNS; columnIndex += 1) {
    const sourceColumn = source.getColumn(columnIndex);
    const targetColumn = target.getColumn(columnIndex);

    if (sourceColumn.width) {
      targetColumn.width = sourceColumn.width;
    }
    if (sourceColumn.hidden) {
      targetColumn.hidden = sourceColumn.hidden;
    }
    if (Object.keys(sourceColumn.style || {}).length > 0) {
      targetColumn.style = cloneJson(sourceColumn.style);
    }
  }
}

function populateHeaderRow(sheet: Worksheet, template: RowTemplate) {
  applyRowTemplate(sheet, 1, template, true);
}

function populateBody(
  sheet: Worksheet,
  {
    rowTemplates,
    assignedPeople,
    taskRows,
    taskTotals,
  }: {
    rowTemplates: {
      header: RowTemplate;
      employeeTotal: RowTemplate;
      spacer: RowTemplate;
      sectionLabel: RowTemplate;
      taskHeader: RowTemplate;
      taskRoot: RowTemplate;
      taskChild: RowTemplate;
      taskTotal: RowTemplate;
      employeeByRole: Record<ProjectRole, RowTemplate>;
    };
    assignedPeople: ReturnType<typeof buildPlanningAssignedPeople>;
    taskRows: PlanningTaskRow[];
    taskTotals: PlanningTaskHours;
  }
) {
  const employeeStartRow = 2;

  assignedPeople.forEach((person, index) => {
    const rowNumber = employeeStartRow + index;
    const rowTemplate = rowTemplates.employeeByRole[person.role];

    applyRowTemplate(sheet, rowNumber, rowTemplate, false);

    sheet.getCell(rowNumber, 1).value = index + 1;
    sheet.getCell(rowNumber, 2).value = `${person.userName} (${getProjectRoleLabel(person.role)})`;
    sheet.getCell(rowNumber, 3).value = person.secondsInPeriod > 0 ? toPlanningHours(person.secondsInPeriod) : null;
    sheet.getCell(rowNumber, 4).value = null;
    sheet.getCell(rowNumber, 5).value = {
      formula: `D${rowNumber}*C${rowNumber}`,
      result: 0,
    };
  });

  const employeeTotalRow = employeeStartRow + assignedPeople.length;
  applyRowTemplate(sheet, employeeTotalRow, rowTemplates.employeeTotal, false);
  sheet.mergeCells(employeeTotalRow, 1, employeeTotalRow, 4);
  sheet.getCell(employeeTotalRow, 5).value =
    assignedPeople.length > 0
      ? {
          formula: `SUM(E${employeeStartRow}:E${employeeTotalRow - 1})`,
          result: 0,
        }
      : 0;

  const spacerRow = employeeTotalRow + 1;
  applyRowTemplate(sheet, spacerRow, rowTemplates.spacer, true);

  const sectionLabelRow = spacerRow + 1;
  applyRowTemplate(sheet, sectionLabelRow, rowTemplates.sectionLabel, true);
  sheet.mergeCells(sectionLabelRow, 1, sectionLabelRow, 2);
  sheet.mergeCells(sectionLabelRow, 3, sectionLabelRow, 9);

  const taskHeaderRow = sectionLabelRow + 1;
  applyRowTemplate(sheet, taskHeaderRow, rowTemplates.taskHeader, true);

  const taskStartRow = taskHeaderRow + 1;
  taskRows.forEach((task, index) => {
    const rowNumber = taskStartRow + index;
    applyRowTemplate(
      sheet,
      rowNumber,
      task.depth === 0 ? rowTemplates.taskRoot : rowTemplates.taskChild,
      false
    );

    sheet.getCell(rowNumber, 1).value = task.rowMarker;
    sheet.getCell(rowNumber, 2).value = task.title;
    sheet.getCell(rowNumber, 2).alignment = {
      ...cloneJson(sheet.getCell(rowNumber, 2).alignment || {}),
      wrapText: true,
    };

    for (const column of PLANNING_EXPORT_COLUMNS) {
      const value = task.hours[column];
      sheet.getCell(rowNumber, TASK_COLUMN_BY_EXPORT_COLUMN[column]).value = value > 0 ? value : null;
    }
  });

  const taskTotalRow = taskStartRow + taskRows.length;
  applyRowTemplate(sheet, taskTotalRow, rowTemplates.taskTotal, false);
  sheet.getCell(taskTotalRow, 2).value = 'Total';

  for (const column of PLANNING_EXPORT_COLUMNS) {
    const columnNumber = TASK_COLUMN_BY_EXPORT_COLUMN[column];
    const columnLetter = sheet.getColumn(columnNumber).letter;
    if (!columnLetter) {
      throw new Error(`Unable to resolve Excel column for planning total "${column}"`);
    }
    const totalValue = taskTotals[column];

    sheet.getCell(taskTotalRow, columnNumber).value =
      taskRows.length > 0
        ? {
            formula: `SUM(${columnLetter}${taskStartRow}:${columnLetter}${taskTotalRow - 1})`,
            result: totalValue,
          }
        : totalValue;
  }

  return { taskStartRow };
}

function captureRowTemplate(sheet: Worksheet, rowNumber: number): RowTemplate {
  const row = sheet.getRow(rowNumber);

  return {
    height: row.height,
    cells: Array.from({ length: MAX_TEMPLATE_COLUMNS }, (_, index) => {
      const cell = row.getCell(index + 1);
      return {
        style: cloneJson(cell.style),
        value: cloneJson(cell.value),
      };
    }),
  };
}

function applyRowTemplate(
  sheet: Worksheet,
  targetRowNumber: number,
  template: RowTemplate,
  copyValues: boolean
) {
  const row = sheet.getRow(targetRowNumber);
  if (typeof template.height === 'number') {
    row.height = template.height;
  }

  template.cells.forEach((cellTemplate, index) => {
    const cell = row.getCell(index + 1);
    cell.style = cloneJson(cellTemplate.style);
    cell.value = copyValues ? cloneJson(cellTemplate.value) : null;
  });
}

function verifyTaskTreeExport(sheet: Worksheet, startRow: number, taskRows: PlanningTaskRow[]) {
  taskRows.forEach((task, index) => {
    const rowNumber = startRow + index;
    const marker = String(sheet.getCell(rowNumber, 1).value ?? '');
    const title = String(sheet.getCell(rowNumber, 2).value ?? '');

    if (marker !== task.rowMarker || title !== task.title) {
      throw new Error(
        `Planning export verification failed on row ${rowNumber}: expected "${task.rowMarker} ${task.title}", got "${marker} ${title}"`
      );
    }
  });
}

function makePlanningSheetName(startDate: string, endDate: string) {
  return trimWorksheetName(`Planning ${startDate} - ${endDate}`);
}

function makePlanningFileName(projectPath: string, startDate: string, endDate: string) {
  const safeProjectPath = projectPath.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${safeProjectPath || 'project'}-planning-${startDate}-to-${endDate}.xlsx`;
}

function trimWorksheetName(value: string) {
  return value.slice(0, 31);
}

function toPlanningHours(seconds: number) {
  return Math.round((seconds / 3600) * 100) / 100;
}

function cloneJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
