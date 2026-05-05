import { useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Inbox,
  Trophy,
} from 'lucide-react';
import type { PersonAggregation } from '../types';
import { downloadPeopleWorkbook } from '../lib/peopleExport';
import { formatHours } from '../lib/time';

interface Props {
  people: PersonAggregation[];
  grandTotalSecondsInPeriod: number;
  projectPath: string;
  period: { start: string; end: string };
}

export function PeopleView({ people, grandTotalSecondsInPeriod, projectPath, period }: Props) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const ranked = people.filter((person) => person.secondsInPeriod > 0);
  const zeroInPeriod = people.filter((person) => person.secondsInPeriod === 0);

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);

    try {
      await downloadPeopleWorkbook({
        people: ranked,
        grandTotalSecondsInPeriod,
        projectPath,
        period,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export people hours');
    } finally {
      setExporting(false);
    }
  };

  if (ranked.length === 0 && zeroInPeriod.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center text-center">
        <div className="h-14 w-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
          <Inbox className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900">No contributors yet</h3>
        <p className="mt-1 text-sm text-slate-500 max-w-md">
          No one logged time in the selected period.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Trophy className="w-4 h-4 text-amber-500" />
              People ranking (by selected period)
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Hours are aggregated across every PM cluster and standalone item in the report.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || ranked.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Preparing XLSX...' : 'Export XLSX'}
          </button>
        </div>

        {exportError && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="flex items-start gap-2 text-sm text-rose-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
              <span>{exportError}</span>
            </div>
          </div>
        )}

        <ul className="mt-5 space-y-3">
          {ranked.map((person, index) => (
            <PersonRow
              key={person.userId}
              person={person}
              index={index + 1}
              totalSecondsInPeriod={grandTotalSecondsInPeriod}
            />
          ))}
        </ul>
      </div>

      {zeroInPeriod.length > 0 && (
        <details className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Contributors without hours in this period ({zeroInPeriod.length})
          </summary>
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {zeroInPeriod.map((person) => (
              <li
                key={person.userId}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
              >
                <Avatar name={person.userName} url={person.userAvatarUrl} size={6} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {person.userName}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    All time: {formatHours(person.secondsAllTime)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PersonRow({
  person,
  index,
  totalSecondsInPeriod,
}: {
  person: PersonAggregation;
  index: number;
  totalSecondsInPeriod: number;
}) {
  const [open, setOpen] = useState(false);
  const share =
    totalSecondsInPeriod > 0 ? (person.secondsInPeriod / totalSecondsInPeriod) * 100 : 0;

  return (
    <li className="rounded-xl border border-slate-200 bg-white hover:shadow-sm transition overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition"
      >
        <div className="shrink-0 w-7 text-center text-sm font-bold text-slate-500 tabular-nums">
          {index}
        </div>
        <Avatar name={person.userName} url={person.userAvatarUrl} size={9} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 truncate">
              {person.userName}
            </span>
            <span className="text-[11px] text-slate-500">
              {person.issuesTouchedInPeriod} issue(s)
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-500 to-emerald-500"
              style={{ width: `${Math.min(100, share)}%` }}
            />
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <div className="text-base font-bold text-sky-700 tabular-nums">
            {formatHours(person.secondsInPeriod)}
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums">
            {share.toFixed(1)}% | all time {formatHours(person.secondsAllTime)}
          </div>
        </div>
        <div className="shrink-0 text-slate-400">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {person.issueBreakdown.length === 0 ? (
            <div className="text-xs text-slate-500">No issue-level breakdown available.</div>
          ) : (
            <ul className="space-y-1.5">
              {person.issueBreakdown.map((breakdown) => (
                <IssueBreakdownRow
                  key={breakdown.issueId}
                  breakdown={breakdown}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function IssueBreakdownRow({
  breakdown,
}: {
  breakdown: PersonAggregation['issueBreakdown'][number];
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg bg-white border border-slate-100 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex flex-1 items-center gap-2 text-left"
        >
          <span className="shrink-0 text-slate-400">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-600">
            {breakdown.projectName}
          </span>
          <span className="text-xs font-mono text-slate-500">#{breakdown.issueIid}</span>
          <span className="truncate text-sm font-medium text-slate-800">
            {breakdown.issueTitle}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-sm font-semibold text-sky-700 tabular-nums whitespace-nowrap">
            {formatHours(breakdown.secondsInPeriod)}
          </div>
          <a
            href={breakdown.issueWebUrl}
            target="_blank"
            rel="noreferrer"
            className="text-slate-400 hover:text-sky-700 transition"
            aria-label={`Open ${breakdown.issueTitle}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
          {breakdown.timelogs.length === 0 ? (
            <div className="text-xs text-slate-500">No dated timelogs available.</div>
          ) : (
            <ul className="space-y-1">
              {breakdown.timelogs.map((timelog) => (
                <li
                  key={timelog.id}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs"
                >
                  <div className="min-w-0 flex items-start gap-2 text-slate-600">
                    <CalendarClock className="mt-0.5 h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate">{formatTimelogDate(timelog.spentAt)}</div>
                      {timelog.summary && (
                        <div className="mt-0.5 whitespace-pre-wrap break-words text-slate-500">
                          {timelog.summary}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="font-semibold tabular-nums text-slate-800">
                    {formatHours(timelog.seconds)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function Avatar({ name, url, size }: { name: string; url?: string; size: number }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const px = size * 4;
  const style = { width: `${px}px`, height: `${px}px` };

  if (url) {
    return <img src={url} alt={name} style={style} className="rounded-full object-cover" />;
  }

  return (
    <div
      style={style}
      className="rounded-full bg-gradient-to-br from-sky-400 to-emerald-500 text-white text-xs font-semibold flex items-center justify-center"
    >
      {initials}
    </div>
  );
}

function formatTimelogDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const hasTime = !/T00:00:00(?:\.000)?Z?$/.test(value);
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
