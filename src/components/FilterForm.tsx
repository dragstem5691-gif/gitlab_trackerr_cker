import { useState } from 'react';
import { Calendar, FolderGit2, KeyRound, Loader2, Play, Server, Sparkles } from 'lucide-react';
import type { FilterFormValues } from '../types';

interface Props {
  initialValues: FilterFormValues;
  isLoading: boolean;
  onSubmit: (values: FilterFormValues) => void;
  onDemo: () => void;
  error: string | null;
}

export function FilterForm({ initialValues, isLoading, onSubmit, onDemo, error }: Props) {
  const [values, setValues] = useState<FilterFormValues>(initialValues);
  const [touched, setTouched] = useState(false);

  const isValid =
    values.instanceUrl.trim() &&
    values.token.trim() &&
    values.projectPath.trim() &&
    values.startDate &&
    values.endDate &&
    values.startDate <= values.endDate;

  const update = (k: keyof FilterFormValues, v: string) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;
    onSubmit(values);
  };

  const fieldError = (cond: boolean) =>
    touched && cond ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-200' : '';

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center text-white">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Build time report</h2>
            <p className="text-sm text-slate-500">
              Credentials stay in your browser session only.
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field
          label="Main project/group URL"
          icon={<Server className="w-4 h-4" />}
          hint="Link to the main GitLab project or group that contains all boards: PM, backend, frontend, and others, e.g. https://gitlab.example.com/crypto_payments/bps/"
        >
          <input
            type="text"
            value={values.instanceUrl}
            onChange={(e) => update('instanceUrl', e.target.value)}
            placeholder="https://gitlab.example.com/crypto_payments/bps/"
            className={`w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 transition ${fieldError(
              !values.instanceUrl.trim()
            )}`}
          />
        </Field>

        <Field
          label="Personal Access Token"
          icon={<KeyRound className="w-4 h-4" />}
          hint="api, read_api scope. Stored only in sessionStorage."
        >
          <input
            type="password"
            value={values.token}
            onChange={(e) => update('token', e.target.value)}
            placeholder="glpat-..."
            className={`w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 transition ${fieldError(
              !values.token.trim()
            )}`}
          />
        </Field>

        <Field
          label="Main PM project"
          icon={<FolderGit2 className="w-4 h-4" />}
          hint="Link to the specific PM subproject inside the main project. Example: https://gitlab.example.com/crypto_payments/bps/bps-pm"
          className="md:col-span-2"
        >
          <input
            type="text"
            value={values.projectPath}
            onChange={(e) => update('projectPath', e.target.value)}
            placeholder="https://gitlab.example.com/crypto_payments/bps/bps-pm"
            className={`w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 transition ${fieldError(
              !values.projectPath.trim()
            )}`}
          />
        </Field>

        <Field label="Start date" icon={<Calendar className="w-4 h-4" />}>
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => update('startDate', e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 transition ${fieldError(
              !values.startDate
            )}`}
          />
        </Field>

        <Field label="End date" icon={<Calendar className="w-4 h-4" />}>
          <input
            type="date"
            value={values.endDate}
            onChange={(e) => update('endDate', e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 transition ${fieldError(
              !values.endDate || values.startDate > values.endDate
            )}`}
          />
        </Field>
      </div>

      {error && (
        <div className="mx-6 mb-4 px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="p-6 pt-0 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onDemo}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 transition"
        >
          Try with demo dataset from spec
        </button>

        <button
          type="submit"
          disabled={!isValid || isLoading}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 text-white font-medium shadow-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Building report...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Build report
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  icon,
  hint,
  children,
  className = '',
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
