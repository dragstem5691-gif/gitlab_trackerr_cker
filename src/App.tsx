import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock4, Github, ShieldCheck } from 'lucide-react';
import { FilterForm } from './components/FilterForm';
import { ReportView } from './components/ReportView';
import { BuildLog } from './components/BuildLog';
import { GitLabClient, loadReportData } from './lib/gitlab';
import { buildReport } from './lib/aggregation';
import { BuildLogger, type LogEntry } from './lib/logger';
import { DEMO_ISSUES, DEMO_PROJECT_PATH } from './lib/demoData';
import { parseInstanceOrigin, parseProjectPath } from './lib/time';
import { ensureAnonymousSession, loadPreset, savePreset } from './lib/supabase';
import type { FilterFormValues, ReportResult } from './types';

const SESSION_KEY_FORM = 'gtr.form';
const SESSION_KEY_TOKEN = 'gtr.token';

function loadInitialValues(): FilterFormValues {
  const defaultValues: FilterFormValues = {
    instanceUrl: 'https://gitlab.com',
    token: '',
    projectPath: '',
    startDate: '2026-04-01',
    endDate: '2026-04-05',
  };

  try {
    const raw = sessionStorage.getItem(SESSION_KEY_FORM);
    const token = sessionStorage.getItem(SESSION_KEY_TOKEN) || '';
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultValues, ...parsed, token };
    }
  } catch {
    /* ignore */
  }

  return defaultValues;
}

function App() {
  const initial = useMemo(loadInitialValues, []);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formSnapshot, setFormSnapshot] = useState<FilterFormValues>(initial);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const pendingLogEntriesRef = useRef<LogEntry[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const hydratedFromRemoteRef = useRef(false);

  useEffect(() => {
    const { token, ...rest } = formSnapshot;
    sessionStorage.setItem(SESSION_KEY_FORM, JSON.stringify(rest));
    if (token) sessionStorage.setItem(SESSION_KEY_TOKEN, token);
  }, [formSnapshot]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await ensureAnonymousSession();
      if (cancelled || !id) return;
      setUserId(id);
      const preset = await loadPreset(id);
      if (cancelled || !preset) {
        hydratedFromRemoteRef.current = true;
        return;
      }
      setFormSnapshot((current) => ({
        ...current,
        instanceUrl: preset.instance_url || current.instanceUrl,
        projectPath: preset.project_path || current.projectPath,
        startDate: preset.start_date || current.startDate,
        endDate: preset.end_date || current.endDate,
      }));
      hydratedFromRemoteRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId || !hydratedFromRemoteRef.current) return;
    const handle = window.setTimeout(() => {
      savePreset(userId, {
        instance_url: formSnapshot.instanceUrl,
        project_path: formSnapshot.projectPath,
        start_date: formSnapshot.startDate || null,
        end_date: formSnapshot.endDate || null,
      }).catch(() => {
        /* ignore network errors */
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [userId, formSnapshot.instanceUrl, formSnapshot.projectPath, formSnapshot.startDate, formSnapshot.endDate]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const flushLogBuffer = () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (pendingLogEntriesRef.current.length === 0) return;

    const nextBatch = pendingLogEntriesRef.current;
    pendingLogEntriesRef.current = [];
    setLogEntries((prev) => (prev.length === 0 ? nextBatch : [...prev, ...nextBatch]));
  };

  const scheduleLogFlush = () => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushLogBuffer();
    }, 75);
  };

  const createLogger = () => {
    pendingLogEntriesRef.current = [];
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setLogEntries([]);
    return new BuildLogger((entry) => {
      pendingLogEntriesRef.current.push(entry);
      scheduleLogFlush();
    });
  };

  const handleSubmit = async (values: FilterFormValues) => {
    setFormSnapshot(values);
    setError(null);
    setLoading(true);
    setReport(null);
    const logger = createLogger();

    try {
      logger.phase('Build report requested');
      logger.info(`Instance URL input: ${values.instanceUrl}`);
      logger.info(`Project path input: ${values.projectPath}`);
      logger.info(`Period: ${values.startDate} - ${values.endDate}`);

      const origin = parseInstanceOrigin(values.instanceUrl);
      const projectPath = parseProjectPath(values.projectPath);
      if (!origin) throw new Error('Invalid GitLab instance URL');
      if (!projectPath) throw new Error('Invalid project URL or path');

      logger.success(`Resolved instance origin: ${origin}`);
      logger.success(`Resolved project path: ${projectPath}`);

      const client = new GitLabClient(origin, values.token);
      const data = await loadReportData(
        client,
        projectPath,
        values.startDate,
        values.endDate,
        logger
      );
      logger.success(`Fetched ${data.issues.length} total issues from PM clusters and branches`);

      const result = buildReport(
        data.issues,
        projectPath,
        values.startDate,
        values.endDate,
        data.warnings,
        logger
      );
      logger.success('Report ready');
      flushLogBuffer();
      setReport(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build report';
      logger.error(`Build failed: ${message}`);
      flushLogBuffer();
      setError(message);
    } finally {
      flushLogBuffer();
      setLoading(false);
    }
  };

  const handleDemo = () => {
    const demoValues: FilterFormValues = {
      ...formSnapshot,
      projectPath: `https://gitlab.example.com/${DEMO_PROJECT_PATH}`,
      startDate: '2026-04-01',
      endDate: '2026-04-05',
    };
    setFormSnapshot(demoValues);
    setError(null);
    setReport(null);

    const logger = createLogger();
    logger.phase('Demo report requested');
    logger.info('Using bundled demo dataset (no GitLab requests)');
    logger.info(`Demo project: ${DEMO_PROJECT_PATH}`);
    logger.success(`Loaded ${DEMO_ISSUES.length} demo issues`);

    const result = buildReport(
      DEMO_ISSUES,
      DEMO_PROJECT_PATH,
      demoValues.startDate,
      demoValues.endDate,
      [],
      logger
    );

    logger.success('Demo report ready');
    flushLogBuffer();
    setReport(result);
  };

  const handleReset = () => {
    pendingLogEntriesRef.current = [];
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setReport(null);
    setError(null);
    setLogEntries([]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-900 to-sky-700 text-white flex items-center justify-center shadow-sm">
              <Clock4 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">
                GitLab Time Tracking Report
              </h1>
              <p className="text-xs text-slate-500">
                Per-user hours with PM-linked task clusters
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" />
              Session-only storage
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200">
              <Github className="w-3.5 h-3.5" />
              GitLab GraphQL
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {!report && (
          <div className="text-center max-w-2xl mx-auto mb-6">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Build a clean time report in seconds
            </h2>
            <p className="mt-3 text-slate-600">
              Pick a PM project and a date range to see tracked hours per person, per issue, and
              across linked subprojects, with total time and period time side by side.
            </p>
          </div>
        )}

        <FilterForm
          initialValues={formSnapshot}
          onSubmit={handleSubmit}
          onDemo={handleDemo}
          isLoading={loading}
          error={error}
        />

        {(logEntries.length > 0 || loading) && (
          <BuildLog entries={logEntries} isRunning={loading} defaultOpen={loading || !report} />
        )}

        {report && <ReportView report={report} onReset={handleReset} />}
      </main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-8 text-center text-xs text-slate-400">
        Your GitLab token is kept only in this browser tab&apos;s sessionStorage and never sent
        anywhere except to your GitLab instance.
      </footer>
    </div>
  );
}

export default App;
