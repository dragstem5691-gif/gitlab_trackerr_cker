import { useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { CalendarRange, Download, ExternalLink, Inbox, Users } from 'lucide-react';
import type { RawIssue, ReportResult } from '../types';
import { extractSpentAtDate, formatHours, isInPeriod } from '../lib/time';

const MAX_VISIBLE_DAYS = 30;

interface DensityConfig {
  dayCellWidth: number;
  trackHeight: number;
  trackGap: number;
  rowVerticalPadding: number;
  minRowHeight: number;
  taskColumnMinWidth: number;
  taskColumnMaxWidth: number;
  taskColumnPadding: number;
  titleMeasureFont: string;
  metaMeasureFont: string;
  titleTextClass: string;
  metaTextClass: string;
}

const DEFAULT_DENSITY: DensityConfig = {
  dayCellWidth: 30,
  trackHeight: 14,
  trackGap: 3,
  rowVerticalPadding: 5,
  minRowHeight: 24,
  taskColumnMinWidth: 220,
  taskColumnMaxWidth: 420,
  taskColumnPadding: 40,
  titleMeasureFont: '500 12px "Segoe UI", system-ui, sans-serif',
  metaMeasureFont: '400 10px "Segoe UI", system-ui, sans-serif',
  titleTextClass: 'text-[12px] leading-4',
  metaTextClass: 'text-[10px] leading-4',
};

const FOCUSED_DENSITY: DensityConfig = {
  dayCellWidth: 24,
  trackHeight: 10,
  trackGap: 2,
  rowVerticalPadding: 3,
  minRowHeight: 18,
  taskColumnMinWidth: 180,
  taskColumnMaxWidth: 340,
  taskColumnPadding: 28,
  titleMeasureFont: '500 11px "Segoe UI", system-ui, sans-serif',
  metaMeasureFont: '400 9px "Segoe UI", system-ui, sans-serif',
  titleTextClass: 'text-[11px] leading-3.5',
  metaTextClass: 'text-[9px] leading-3',
};

interface PersonColor {
  fill: string;
  strong: string;
  border: string;
  text: string;
}

interface GanttDayEntry {
  dateIndex: number;
  date: string;
  seconds: number;
}

interface GanttTrack {
  userId: string;
  userName: string;
  totalSeconds: number;
  days: GanttDayEntry[];
}

const WORK_DAY_SECONDS = 8 * 60 * 60;

interface GanttRow {
  issueId: string;
  issueIid: string;
  issueTitle: string;
  issueWebUrl: string;
  projectName: string;
  totalSecondsInPeriod: number;
  tracks: GanttTrack[];
  firstActiveIndex: number;
}

interface GanttModel {
  dates: string[];
  rows: GanttRow[];
  colorsByUserId: Record<string, PersonColor>;
  taskColumnWidth: number;
  timelineWidth: number;
  visibleTimelineWidth: number;
  density: DensityConfig;
  selectedUserName?: string;
}

export function GanttView({ report }: { report: ReportResult }) {
  const activePeople = useMemo(
    () => report.people.filter((person) => person.secondsInPeriod > 0),
    [report.people]
  );
  const fullRangeDates = useMemo(
    () => enumerateDates(report.period.start, report.period.end),
    [report.period.end, report.period.start]
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedUserId && !activePeople.some((person) => person.userId === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [activePeople, selectedUserId]);

  useEffect(() => {
    if (selectedDate && !fullRangeDates.includes(selectedDate)) {
      setSelectedDate(null);
    }
  }, [fullRangeDates, selectedDate]);

  const model = useMemo(
    () => buildGanttModel(report, selectedUserId, selectedDate),
    [report, selectedUserId, selectedDate]
  );
  const visibleLegendPeople = useMemo(() => {
    const visibleIds = new Set<string>();

    for (const row of model.rows) {
      for (const track of row.tracks) {
        visibleIds.add(track.userId);
      }
    }

    return report.people.filter((person) => visibleIds.has(person.userId));
  }, [model.rows, report.people]);
  const isScrollable = model.dates.length > MAX_VISIBLE_DAYS;
  const isFocused = Boolean(selectedUserId);
  const isDateFiltered = Boolean(selectedDate);

  async function handleExportPng() {
    if (!exportRef.current || isExporting) {
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        pixelRatio: 2,
      });

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = buildExportFileName(report.projectPath, selectedUserId, selectedDate);
      link.click();
    } catch (error) {
      console.error('Failed to export Gantt PNG', error);
      setExportError('PNG export failed. Try again after the chart finishes rendering.');
    } finally {
      setIsExporting(false);
    }
  }

  if (model.rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center text-center">
        <div className="h-14 w-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
          <Inbox className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900">
          {selectedDate
            ? 'No tasks for selected day'
            : selectedUserId
              ? 'No tasks for selected person'
              : 'No Gantt data for this period'}
        </h3>
        <p className="mt-1 text-sm text-slate-500 max-w-md">
          {selectedDate
            ? `No timed tasks match ${formatLongDate(selectedDate)} with the current filters.`
            : selectedUserId
              ? 'This contributor has no timed tasks in the selected period.'
              : 'The chart is built from issue timelogs in the selected period. No task has dated activity to display.'}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CalendarRange className="h-4 w-4 text-sky-700" />
                Gantt
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {isFocused && isDateFiltered
                  ? `Focused view for ${model.selectedUserName} on ${formatLongDate(selectedDate!)}.`
                  : isFocused
                    ? `Focused view for ${model.selectedUserName}. Only matching tasks are shown.`
                    : isDateFiltered
                      ? `Day filter active: ${formatLongDate(selectedDate!)}. Click the same date again to reset.`
                      : 'Compact timeline view: tasks on rows, dates on columns, contributors by color.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
              <InfoBadge>
                <CalendarRange className="h-3.5 w-3.5" />
                {model.dates.length} day(s)
              </InfoBadge>
              <InfoBadge>
                <Users className="h-3.5 w-3.5" />
                {activePeople.length} dev(s)
              </InfoBadge>
              <InfoBadge>{model.rows.length} task(s)</InfoBadge>
              <InfoBadge>{Math.min(model.dates.length, MAX_VISIBLE_DAYS)} day viewport</InfoBadge>
              {selectedDate && <InfoBadge>{formatLongDate(selectedDate)}</InfoBadge>}
              {isScrollable && <InfoBadge>scroll right for more days</InfoBadge>}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-slate-500">
              Export saves the chart exactly as currently filtered.
            </div>
            <button
              type="button"
              onClick={handleExportPng}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              {isExporting ? 'Preparing PNG...' : 'Export PNG'}
            </button>
          </div>

          {exportError && <p className="mt-2 text-[11px] text-rose-600">{exportError}</p>}
        </div>

        <div className="border-b border-slate-200 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={!selectedUserId}
              onClick={() => setSelectedUserId(null)}
              color={undefined}
              label="All people"
            />
            {activePeople.map((person) => (
              <FilterChip
                key={person.userId}
                active={selectedUserId === person.userId}
                onClick={() =>
                  setSelectedUserId((current) =>
                    current === person.userId ? null : person.userId
                  )
                }
                color={model.colorsByUserId[person.userId]}
                label={person.userName}
              />
            ))}
          </div>
        </div>

        <div className="p-3">
          <div
            className="w-full overflow-x-auto rounded-lg border border-slate-200"
            style={{ maxWidth: model.taskColumnWidth + model.visibleTimelineWidth }}
          >
            <div
              className="bg-white"
              style={{ width: model.taskColumnWidth + model.timelineWidth }}
            >
              <GanttLegend
                people={visibleLegendPeople}
                colorsByUserId={model.colorsByUserId}
              />
              <GanttGrid
                model={model}
                selectedDate={selectedDate}
                focusedUserId={selectedUserId}
                onSelectDate={(date) =>
                  setSelectedDate((current) => (current === date ? null : date))
                }
                interactive
              />
            </div>
          </div>
        </div>
      </div>

      <div className="fixed left-[-100000px] top-0 pointer-events-none">
        <div
          ref={exportRef}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          style={{ width: model.taskColumnWidth + model.timelineWidth + 32 }}
        >
          <div className="border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <CalendarRange className="h-4 w-4 text-sky-700" />
              Gantt export
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {report.projectPath} | {report.period.start} - {report.period.end}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
              <InfoBadge>{model.rows.length} task(s)</InfoBadge>
              <InfoBadge>{model.dates.length} day(s)</InfoBadge>
              <InfoBadge>
                {selectedUserId ? model.selectedUserName ?? 'Filtered user' : 'All people'}
              </InfoBadge>
              <InfoBadge>{selectedDate ? formatLongDate(selectedDate) : 'All dates'}</InfoBadge>
            </div>
          </div>

          <div className="mt-3">
            <GanttLegend
              people={visibleLegendPeople}
              colorsByUserId={model.colorsByUserId}
            />
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <GanttGrid
              model={model}
              selectedDate={selectedDate}
              focusedUserId={selectedUserId}
              interactive={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function GanttGrid({
  model,
  selectedDate,
  focusedUserId,
  onSelectDate,
  interactive,
}: {
  model: GanttModel;
  selectedDate: string | null;
  focusedUserId: string | null;
  onSelectDate?: (date: string) => void;
  interactive: boolean;
}) {
  return (
    <>
      <div className="flex border-b border-slate-200 bg-slate-100/80">
        <div
          className="shrink-0 border-r border-slate-200 bg-slate-100/80 px-2 py-1.5"
          style={{ width: model.taskColumnWidth }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Task
          </div>
        </div>

        <div className="shrink-0" style={{ width: model.timelineWidth }}>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${model.dates.length}, ${model.density.dayCellWidth}px)`,
            }}
          >
            {model.dates.map((date) =>
              interactive ? (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelectDate?.(date)}
                  title={
                    selectedDate === date
                      ? `Show all dates instead of ${formatLongDate(date)}`
                      : `Show only ${formatLongDate(date)}`
                  }
                  className={`border-r border-slate-200 px-0.5 py-1 text-center transition ${
                    selectedDate === date
                      ? 'bg-sky-200/80 ring-1 ring-inset ring-sky-400'
                      : isWeekend(date)
                        ? 'bg-amber-100/90 hover:bg-amber-200/90'
                        : 'hover:bg-slate-200/60'
                  }`}
                >
                  <DateHeaderCell date={date} selected={selectedDate === date} />
                </button>
              ) : (
                <div
                  key={date}
                  className={`border-r border-slate-200 px-0.5 py-1 text-center ${
                    selectedDate === date
                      ? 'bg-sky-200/80'
                      : isWeekend(date)
                        ? 'bg-amber-100/90'
                        : ''
                  }`}
                >
                  <DateHeaderCell date={date} selected={selectedDate === date} />
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-200">
        {model.rows.map((row, rowIndex) => (
          <GanttTaskRow
            key={row.issueId}
            row={row}
            rowIndex={rowIndex}
            dates={model.dates}
            taskColumnWidth={model.taskColumnWidth}
            density={model.density}
            colorsByUserId={model.colorsByUserId}
            focusedUserId={focusedUserId}
          />
        ))}
      </div>
    </>
  );
}

function GanttTaskRow({
  row,
  rowIndex,
  dates,
  taskColumnWidth,
  density,
  colorsByUserId,
  focusedUserId,
}: {
  row: GanttRow;
  rowIndex: number;
  dates: string[];
  taskColumnWidth: number;
  density: DensityConfig;
  colorsByUserId: Record<string, PersonColor>;
  focusedUserId: string | null;
}) {
  const rowHeight = Math.max(
    density.minRowHeight,
    density.rowVerticalPadding * 2 +
      row.tracks.length * density.trackHeight +
      Math.max(0, row.tracks.length - 1) * density.trackGap
  );
  const rowBgClass = rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
  const timelineWidth = dates.length * density.dayCellWidth;
  const metaText = focusedUserId
    ? `#${row.issueIid} | ${row.projectName} | ${formatHours(row.totalSecondsInPeriod)}`
    : `#${row.issueIid} | ${row.projectName} | ${formatHours(row.totalSecondsInPeriod)} | ${row.tracks.length} dev`;

  return (
    <div className={`flex ${rowBgClass}`}>
      <div
        className={`shrink-0 border-r border-slate-200 px-2 py-1 ${rowBgClass}`}
        style={{ width: taskColumnWidth, minHeight: rowHeight }}
      >
        <div className="flex h-full flex-col justify-center">
          <a
            href={row.issueWebUrl}
            target="_blank"
            rel="noreferrer"
            title={row.issueTitle}
            className={`inline-flex min-w-0 items-center gap-1 font-medium text-slate-900 hover:text-sky-700 ${density.titleTextClass}`}
          >
            <span className="truncate">{row.issueTitle}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
          </a>

          <div className={`mt-0.5 truncate text-slate-500 ${density.metaTextClass}`} title={metaText}>
            {metaText}
          </div>
        </div>
      </div>

      <div className={`relative shrink-0 ${rowBgClass}`} style={{ width: timelineWidth, height: rowHeight }}>
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${dates.length}, ${density.dayCellWidth}px)` }}
        >
          {dates.map((date) => (
            <div
              key={date}
              className={`border-r border-slate-200 ${isWeekend(date) ? 'bg-amber-50/85' : ''}`}
            />
          ))}
        </div>

        {row.tracks.map((track, trackIndex) => {
          const color = colorsByUserId[track.userId];
          const top =
            density.rowVerticalPadding +
            trackIndex * (density.trackHeight + density.trackGap);

          return track.days.map((day) => {
            const left = day.dateIndex * density.dayCellWidth + 2;
            const width = density.dayCellWidth - 4;
            const intensity = Math.min(1, day.seconds / WORK_DAY_SECONDS);
            const dayHoursLabel = formatHours(day.seconds);
            const showLabel = width >= 22 && density.trackHeight >= 12;

            return (
              <div
                key={`${track.userId}-${day.date}`}
                className="absolute flex items-center justify-center rounded-sm border text-[9px] font-semibold leading-none"
                style={{
                  left,
                  top,
                  width,
                  height: density.trackHeight,
                  backgroundColor: color.fill,
                  borderColor: color.border,
                  color: color.text,
                  opacity: 0.55 + 0.45 * intensity,
                }}
                title={`${track.userName}: ${dayHoursLabel} on ${formatLongDate(day.date)} (${Math.round(intensity * 100)}% of 8h workday)`}
              >
                {showLabel && (
                  <span className="truncate px-0.5 tabular-nums">{dayHoursLabel}</span>
                )}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  label,
}: {
  active: boolean;
  onClick: () => void;
  color?: PersonColor;
  label: string;
}) {
  const style = color
    ? {
        backgroundColor: active ? color.fill : undefined,
        borderColor: active ? color.border : undefined,
        color: active ? color.text : undefined,
      }
    : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={style}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium transition ${
        active
          ? 'border-slate-300 shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
      }`}
    >
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color.strong }} />
      )}
      {label}
    </button>
  );
}

function InfoBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1">
      {children}
    </span>
  );
}

function GanttLegend({
  people,
  colorsByUserId,
}: {
  people: ReportResult['people'];
  colorsByUserId: Record<string, PersonColor>;
}) {
  return (
    <div className="border-b border-slate-200 bg-white px-3 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Legend
        </span>
        {people.map((person) => (
          <LegendBadge
            key={person.userId}
            label={person.userName}
            color={colorsByUserId[person.userId]}
          />
        ))}
      </div>
    </div>
  );
}

function LegendBadge({ label, color }: { label: string; color?: PersonColor }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700"
      style={
        color
          ? {
              backgroundColor: color.fill,
              borderColor: color.border,
              color: color.text,
            }
          : undefined
      }
    >
      <span
        className="h-2.5 w-2.5 rounded-full border border-black/10"
        style={{ backgroundColor: color?.strong ?? '#64748b' }}
      />
      {label}
    </span>
  );
}

function DateHeaderCell({ date, selected }: { date: string; selected: boolean }) {
  return (
    <>
      <div
        className={`text-[11px] font-semibold leading-none tabular-nums ${
          selected
            ? 'text-sky-950'
            : isWeekend(date)
              ? 'text-amber-950'
              : 'text-slate-900'
        }`}
      >
        {formatDay(date)}
      </div>
      <div
        className={`mt-0.5 text-[9px] uppercase leading-none ${
          selected
            ? 'text-sky-700'
            : isWeekend(date)
              ? 'text-amber-700'
              : 'text-slate-500'
        }`}
      >
        {formatWeekday(date)}
      </div>
    </>
  );
}

function buildGanttModel(
  report: ReportResult,
  selectedUserId: string | null,
  selectedDate: string | null
): GanttModel {
  const density = selectedUserId ? FOCUSED_DENSITY : DEFAULT_DENSITY;
  const dates = selectedDate
    ? [selectedDate]
    : enumerateDates(report.period.start, report.period.end);
  const dateIndexByDate = new Map(dates.map((date, index) => [date, index]));
  const colorsByUserId: Record<string, PersonColor> = {};
  const peopleOrder = new Map<string, number>();

  report.people.forEach((person, index) => {
    peopleOrder.set(person.userId, index);
    colorsByUserId[person.userId] = buildPersonColor(index);
  });

  const rows: GanttRow[] = [];
  for (const issue of collectUniqueIssues(report)) {
    const tracksByUserId = new Map<
      string,
      { userId: string; userName: string; totalSeconds: number; secondsByDate: Map<string, number> }
    >();
    let totalSecondsInPeriod = 0;

    for (const entry of issue.timelogs) {
      if (!isInPeriod(entry.spentAt, report.period.start, report.period.end)) continue;
      if (selectedUserId && entry.userId !== selectedUserId) continue;

      const spentDate = extractSpentAtDate(entry.spentAt);
      if (selectedDate && spentDate !== selectedDate) continue;
      if (!spentDate || !dateIndexByDate.has(spentDate)) continue;

      totalSecondsInPeriod += entry.timeSpentSeconds;
      let track = tracksByUserId.get(entry.userId);
      if (!track) {
        track = {
          userId: entry.userId,
          userName: entry.userName,
          totalSeconds: 0,
          secondsByDate: new Map<string, number>(),
        };
        tracksByUserId.set(entry.userId, track);
      }

      track.userName = entry.userName;
      track.totalSeconds += entry.timeSpentSeconds;
      track.secondsByDate.set(
        spentDate,
        (track.secondsByDate.get(spentDate) ?? 0) + entry.timeSpentSeconds
      );
      if (!colorsByUserId[entry.userId]) {
        colorsByUserId[entry.userId] = buildPersonColor(Object.keys(colorsByUserId).length);
      }
    }

    if (tracksByUserId.size === 0 || totalSecondsInPeriod === 0) continue;

    const tracks = Array.from(tracksByUserId.values())
      .map((track) => ({
        userId: track.userId,
        userName: track.userName,
        totalSeconds: track.totalSeconds,
        days: Array.from(track.secondsByDate.entries())
          .map(([date, seconds]) => ({
            date,
            seconds,
            dateIndex: dateIndexByDate.get(date) ?? -1,
          }))
          .filter((entry) => entry.dateIndex >= 0)
          .sort((left, right) => left.dateIndex - right.dateIndex),
      }))
      .sort(
        (left, right) =>
          (peopleOrder.get(left.userId) ?? Number.MAX_SAFE_INTEGER) -
            (peopleOrder.get(right.userId) ?? Number.MAX_SAFE_INTEGER) ||
          right.totalSeconds - left.totalSeconds ||
          left.userName.localeCompare(right.userName)
      );

    const firstActiveIndex = Math.min(
      ...tracks.flatMap((track) => track.days.map((day) => day.dateIndex))
    );

    rows.push({
      issueId: issue.id,
      issueIid: issue.iid,
      issueTitle: issue.title,
      issueWebUrl: issue.webUrl,
      projectName: issue.projectName,
      totalSecondsInPeriod,
      tracks,
      firstActiveIndex,
    });
  }

  rows.sort(
    (left, right) =>
      left.firstActiveIndex - right.firstActiveIndex ||
      right.totalSecondsInPeriod - left.totalSecondsInPeriod ||
      left.issueTitle.localeCompare(right.issueTitle)
  );

  return {
    dates,
    rows,
    colorsByUserId,
    taskColumnWidth: calculateTaskColumnWidth(rows, density, Boolean(selectedUserId)),
    timelineWidth: dates.length * density.dayCellWidth,
    visibleTimelineWidth: Math.min(dates.length, MAX_VISIBLE_DAYS) * density.dayCellWidth,
    density,
    selectedUserName:
      report.people.find((person) => person.userId === selectedUserId)?.userName || undefined,
  };
}

function collectUniqueIssues(report: ReportResult): RawIssue[] {
  const issuesById = new Map<string, RawIssue>();

  const visit = (issue: RawIssue, children: RawIssueNode[]) => {
    if (!issuesById.has(issue.id)) {
      issuesById.set(issue.id, issue);
    }
    for (const child of children) {
      visit(child.issue, child.children);
    }
  };

  report.pmTrees.forEach((tree) => {
    tree.pmIssues.forEach((node) => visit(node.issue, node.children));
  });
  report.standalone.forEach((node) => visit(node.issue, node.children));

  return Array.from(issuesById.values());
}

type RawIssueNode = ReportResult['pmTrees'][number]['pmIssues'][number];

function calculateTaskColumnWidth(
  rows: GanttRow[],
  density: DensityConfig,
  focused: boolean
) {
  let widest = density.taskColumnMinWidth;

  for (const row of rows) {
    const titleWidth = measureTextWidth(row.issueTitle, density.titleMeasureFont);
    const metaWidth = measureTextWidth(
      focused
        ? `#${row.issueIid} | ${row.projectName} | ${formatHours(row.totalSecondsInPeriod)}`
        : `#${row.issueIid} | ${row.projectName} | ${formatHours(row.totalSecondsInPeriod)} | ${row.tracks.length} dev`,
      density.metaMeasureFont
    );

    widest = Math.max(widest, titleWidth, metaWidth);
  }

  return clamp(
    Math.ceil(widest + density.taskColumnPadding),
    density.taskColumnMinWidth,
    density.taskColumnMaxWidth
  );
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  let cursor = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();

  while (cursor <= end) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += dayMs;
  }

  return dates;
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

function measureTextWidth(text: string, font: string) {
  if (typeof document === 'undefined') {
    return text.length * 7;
  }

  const canvas = measureTextWidthCanvas();
  const context = canvas.getContext('2d');
  if (!context) {
    return text.length * 7;
  }

  context.font = font;
  return context.measureText(text).width;
}

let measurementCanvas: HTMLCanvasElement | null = null;

function measureTextWidthCanvas() {
  if (!measurementCanvas) {
    measurementCanvas = document.createElement('canvas');
  }

  return measurementCanvas;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatWeekday(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'narrow',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatLongDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(`${date}T00:00:00Z`));
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function buildExportFileName(
  projectPath: string,
  selectedUserId: string | null,
  selectedDate: string | null
) {
  const safeProject = projectPath.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  const suffix = [
    'gantt',
    selectedUserId ? 'filtered-user' : null,
    selectedDate ?? null,
  ]
    .filter(Boolean)
    .join('-');

  return `${safeProject || 'report'}-${suffix}.png`;
}

