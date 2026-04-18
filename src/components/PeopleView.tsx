import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Inbox, Trophy } from 'lucide-react';
import type { PersonAggregation } from '../types';
import { formatHours } from '../lib/time';

interface Props {
  people: PersonAggregation[];
  grandTotalSecondsInPeriod: number;
}

export function PeopleView({ people, grandTotalSecondsInPeriod }: Props) {
  const ranked = people.filter((p) => p.secondsInPeriod > 0);
  const zeroInPeriod = people.filter((p) => p.secondsInPeriod === 0);

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
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Trophy className="w-4 h-4 text-amber-500" />
          People ranking (by selected period)
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Hours are aggregated across every tree and standalone item in the report.
        </p>

        <ul className="mt-5 space-y-3">
          {ranked.map((p, index) => (
            <PersonRow
              key={p.userId}
              person={p}
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
            {zeroInPeriod.map((p) => (
              <li
                key={p.userId}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
              >
                <Avatar name={p.userName} url={p.userAvatarUrl} size={6} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {p.userName}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    All time: {formatHours(p.secondsAllTime)}
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
  const share = totalSecondsInPeriod > 0 ? (person.secondsInPeriod / totalSecondsInPeriod) * 100 : 0;

  return (
    <li className="rounded-xl border border-slate-200 bg-white hover:shadow-sm transition overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
            {share.toFixed(1)}% · all time {formatHours(person.secondsAllTime)}
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
              {person.issueBreakdown.map((b) => (
                <li
                  key={b.issueId}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white border border-slate-100"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-600">
                      {b.projectName}
                    </span>
                    <span className="text-xs font-mono text-slate-500">#{b.issueIid}</span>
                    <a
                      href={b.issueWebUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-slate-800 hover:text-sky-700 transition truncate"
                    >
                      <span className="truncate">{b.issueTitle}</span>
                      <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />
                    </a>
                  </div>
                  <div className="text-sm font-semibold text-sky-700 tabular-nums whitespace-nowrap">
                    {formatHours(b.secondsInPeriod)}
                  </div>
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
    .map((p) => p[0])
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
