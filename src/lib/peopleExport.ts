import type { Cell, Worksheet } from 'exceljs';
import type { PersonAggregation } from '../types';

const EXPORT_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TABLE_HEADER_ROW = 6;
const DETAIL_START_ROW = TABLE_HEADER_ROW + 1;

export interface PeopleWorkbookInput {
  people: PersonAggregation[];
  grandTotalSecondsInPeriod: number;
  projectPath: string;
  period: { start: string; end: string };
}

export async function downloadPeopleWorkbook(input: PeopleWorkbookInput) {
  const buffer = await buildPeopleWorkbookBuffer(input);
  const blob = new Blob([buffer], { type: EXPORT_MIME });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = makePeopleFileName(input.projectPath, input.period.start, input.period.end);
  anchor.click();

  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

async function buildPeopleWorkbookBuffer(input: PeopleWorkbookInput) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const usedSheetNames = new Set<string>();
  const peopleWithHours = input.people.filter((person) => person.secondsInPeriod > 0);

  workbook.creator = 'GitLab Time Tracking Report';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  if (peopleWithHours.length === 0) {
    const sheet = workbook.addWorksheet('No hours');
    sheet.getCell(1, 1).value = 'No people with hours in the selected period.';
    sheet.getCell(1, 1).font = { bold: true, color: { argb: 'FF334155' } };
    return workbook.xlsx.writeBuffer();
  }

  for (const person of peopleWithHours) {
    const sheet = workbook.addWorksheet(makeUniqueWorksheetName(person.userName, usedSheetNames));
    populatePersonSheet(sheet, person, input);
  }

  return workbook.xlsx.writeBuffer();
}

function populatePersonSheet(
  sheet: Worksheet,
  person: PersonAggregation,
  input: PeopleWorkbookInput
) {
  sheet.views = [{ state: 'frozen', ySplit: TABLE_HEADER_ROW }];

  setColumnWidths(sheet);
  populateSummary(sheet, person, input);
  populateTable(sheet, person);
}

function setColumnWidths(sheet: Worksheet) {
  const widths = [18, 42, 22, 12, 54, 16, 18, 42];

  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function populateSummary(
  sheet: Worksheet,
  person: PersonAggregation,
  input: PeopleWorkbookInput
) {
  sheet.mergeCells(1, 1, 1, 8);

  const titleCell = sheet.getCell(1, 1);
  titleCell.value = person.userName;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 24;

  setMetaPair(sheet, 2, 1, 'Project', input.projectPath);
  setMetaPair(sheet, 2, 4, 'Period', `${input.period.start} - ${input.period.end}`);
  setMetaPair(sheet, 3, 1, 'Period hours', secondsToHours(person.secondsInPeriod), '0.00');
  setMetaPair(sheet, 3, 4, 'All-time hours', secondsToHours(person.secondsAllTime), '0.00');
  setMetaPair(sheet, 4, 1, 'Issues in period', person.issuesTouchedInPeriod, '0');
  setMetaPair(
    sheet,
    4,
    4,
    'Share',
    input.grandTotalSecondsInPeriod > 0
      ? person.secondsInPeriod / input.grandTotalSecondsInPeriod
      : 0,
    '0.0%'
  );
}

function setMetaPair(
  sheet: Worksheet,
  rowNumber: number,
  labelColumn: number,
  label: string,
  value: string | number,
  numFmt?: string
) {
  const labelCell = sheet.getCell(rowNumber, labelColumn);
  const valueCell = sheet.getCell(rowNumber, labelColumn + 1);

  labelCell.value = label;
  labelCell.font = { bold: true, color: { argb: 'FF475569' } };
  labelCell.alignment = { vertical: 'middle' };
  valueCell.value = value;
  valueCell.font = { color: { argb: 'FF0F172A' } };
  valueCell.alignment = { vertical: 'middle' };
  if (numFmt) valueCell.numFmt = numFmt;
}

function populateTable(sheet: Worksheet, person: PersonAggregation) {
  const headers = [
    'Spent at',
    'Comment',
    'Project',
    'Issue',
    'Title',
    'Timelog hours',
    'Issue total hours',
    'GitLab link',
  ];
  const headerRow = sheet.getRow(TABLE_HEADER_ROW);

  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
    applyBorder(cell);
  });
  headerRow.height = 22;

  let rowNumber = DETAIL_START_ROW;
  let timelogSecondsTotal = 0;

  for (const breakdown of person.issueBreakdown) {
    const timelogs = [...breakdown.timelogs].sort((left, right) =>
      left.spentAt.localeCompare(right.spentAt)
    );

    if (timelogs.length === 0) {
      addDetailRow(sheet, rowNumber, {
        spentAt: '',
        summary: '',
        projectName: breakdown.projectName,
        issueLabel: `#${breakdown.issueIid}`,
        issueTitle: breakdown.issueTitle,
        timelogHours: null,
        issueTotalHours: secondsToHours(breakdown.secondsInPeriod),
        issueWebUrl: breakdown.issueWebUrl,
      });
      rowNumber += 1;
      continue;
    }

    timelogs.forEach((timelog, index) => {
      timelogSecondsTotal += timelog.seconds;
      addDetailRow(sheet, rowNumber, {
        spentAt: formatSpentAt(timelog.spentAt),
        summary: timelog.summary ?? '',
        projectName: breakdown.projectName,
        issueLabel: `#${breakdown.issueIid}`,
        issueTitle: breakdown.issueTitle,
        timelogHours: secondsToHours(timelog.seconds),
        issueTotalHours: index === 0 ? secondsToHours(breakdown.secondsInPeriod) : null,
        issueWebUrl: breakdown.issueWebUrl,
      });
      rowNumber += 1;
    });
  }

  const totalRowNumber = rowNumber;
  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.getCell(5).value = 'Total';
  totalRow.getCell(5).font = { bold: true, color: { argb: 'FF0F172A' } };
  totalRow.getCell(6).value =
    rowNumber > DETAIL_START_ROW
      ? {
          formula: `SUM(F${DETAIL_START_ROW}:F${rowNumber - 1})`,
          result: secondsToHours(timelogSecondsTotal),
        }
      : 0;
  totalRow.getCell(7).value =
    rowNumber > DETAIL_START_ROW
      ? {
          formula: `SUM(G${DETAIL_START_ROW}:G${rowNumber - 1})`,
          result: secondsToHours(person.secondsInPeriod),
        }
      : secondsToHours(person.secondsInPeriod);
  totalRow.eachCell((cell) => {
    cell.font = { ...(cell.font || {}), bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };
    applyBorder(cell);
  });
  totalRow.getCell(6).numFmt = '0.00';
  totalRow.getCell(7).numFmt = '0.00';

  sheet.autoFilter = {
    from: { row: TABLE_HEADER_ROW, column: 1 },
    to: { row: TABLE_HEADER_ROW, column: headers.length },
  };
}

function addDetailRow(
  sheet: Worksheet,
  rowNumber: number,
  row: {
    spentAt: string;
    summary: string;
    projectName: string;
    issueLabel: string;
    issueTitle: string;
    timelogHours: number | null;
    issueTotalHours: number | null;
    issueWebUrl: string;
  }
) {
  const excelRow = sheet.getRow(rowNumber);
  const values = [
    row.spentAt,
    row.summary,
    row.projectName,
    row.issueLabel,
    row.issueTitle,
    row.timelogHours,
    row.issueTotalHours,
  ];

  values.forEach((value, index) => {
    const cell = excelRow.getCell(index + 1);
    cell.value = value;
    cell.alignment = { vertical: 'top', wrapText: index === 1 || index === 4 };
    applyBorder(cell);
    if (index === 5 || index === 6) {
      cell.numFmt = '0.00';
      cell.alignment = { vertical: 'top', horizontal: 'right' };
    }
  });

  const linkCell = excelRow.getCell(8);
  linkCell.value = row.issueWebUrl
    ? {
        text: row.issueWebUrl,
        hyperlink: row.issueWebUrl,
        tooltip: row.issueWebUrl,
      }
    : null;
  linkCell.font = { color: { argb: 'FF2563EB' }, underline: true };
  linkCell.alignment = { vertical: 'top', wrapText: true };
  applyBorder(linkCell);
}

function applyBorder(cell: Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };
}

function makePeopleFileName(projectPath: string, startDate: string, endDate: string) {
  const safeProjectPath = projectPath.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${safeProjectPath || 'project'}-people-hours-${startDate}-to-${endDate}.xlsx`;
}

function makeUniqueWorksheetName(value: string, usedNames: Set<string>) {
  const base = trimWorksheetName(sanitizeWorksheetName(value) || 'Person');
  let candidate = base;
  let index = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeWorksheetName(value: string) {
  return stripControlChars(value)
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripControlChars(value: string) {
  return Array.from(value, (char) => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
}

function trimWorksheetName(value: string) {
  return value.slice(0, 31);
}

function secondsToHours(seconds: number) {
  return Math.round((seconds / 3600) * 100) / 100;
}

function formatSpentAt(value: string) {
  const dateMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  const timeMatch = value.match(/T(\d{2}:\d{2})/);

  if (!dateMatch) return value;
  if (!timeMatch || timeMatch[1] === '00:00') return dateMatch[1];
  return `${dateMatch[1]} ${timeMatch[1]}`;
}
