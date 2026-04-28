import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Clock4, Github, ShieldCheck } from 'lucide-react';
import { FilterForm } from './components/FilterForm';
import { ReportView } from './components/ReportView';
import { BuildLog } from './components/BuildLog';
import { PlanningBuilderView } from './components/PlanningBuilderView';
import { GanttBuilderView } from './components/GanttBuilderView';
import { GitLabClient, loadReportData } from './lib/gitlab';
import { buildReport } from './lib/aggregation';
import { BuildLogger, type LogEntry } from './lib/logger';
import { DEMO_ISSUES, DEMO_PROJECT_PATH } from './lib/demoData';
import {
  buildPlanningBoards,
  syncPlanningAssignments,
  type PlanningAssignments,
} from './lib/planning';
import { parseInstanceOrigin, parseProjectPath } from './lib/time';
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
  const [page, setPage] = useState<'report' | 'planning' | 'ganttBuilder'>('report');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formSnapshot, setFormSnapshot] = useState<FilterFormValues>(initial);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [planningAssignments, setPlanningAssignments] = useState<PlanningAssignments>({});
  const pendingLogEntriesRef = useRef<LogEntry[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const { token, ...rest } = formSnapshot;
    sessionStorage.setItem(SESSION_KEY_FORM, JSON.stringify(rest));
    if (token) sessionStorage.setItem(SESSION_KEY_TOKEN, token);
  }, [formSnapshot]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!report) {
      setPlanningAssignments({});
      return;
    }

    const boards = buildPlanningBoards(report);
    setPlanningAssignments((previous) => syncPlanningAssignments(boards, previous));
  }, [report]);

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
    setPage('report');
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
    setPage('report');
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
    setPage('report');
    setError(null);
    setLogEntries([]);
    setPlanningAssignments({});
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

      <main
        className={`mx-auto px-4 py-8 sm:px-6 ${
          page === 'ganttBuilder' ? 'max-w-[1440px] space-y-5' : 'max-w-6xl space-y-6'
        }`}
      >
        {page !== 'ganttBuilder' && !report && (
          <div className="text-center max-w-2xl mx-auto mb-6">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Build a clean time report in seconds
            </h2>
            <p className="mt-3 text-slate-600">
              Pick a PM project and a date range to see tracked hours per person, per issue, and
              across linked subprojects, with total time and period time side by side.
            </p>
            <button
              type="button"
              onClick={() => setPage('ganttBuilder')}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800"
            >
              <CalendarRange className="h-4 w-4" />
              Open Gantt Builder
            </button>
          </div>
        )}

        {page !== 'ganttBuilder' && (
          <FilterForm
            initialValues={formSnapshot}
            onSubmit={handleSubmit}
            onDemo={handleDemo}
            isLoading={loading}
            error={error}
          />
        )}

        {page !== 'ganttBuilder' && (logEntries.length > 0 || loading) && (
          <BuildLog entries={logEntries} isRunning={loading} defaultOpen={loading || !report} />
        )}

        {report && page === 'report' && (
          <ReportView
            report={report}
            onReset={handleReset}
            onBuildPlanning={() => setPage('planning')}
            onOpenGanttBuilder={() => setPage('ganttBuilder')}
          />
        )}

        {report && page === 'planning' && (
          <PlanningBuilderView
            report={report}
            assignments={planningAssignments}
            onAssignmentsChange={setPlanningAssignments}
            onBack={() => setPage('report')}
          />
        )}

        {page === 'ganttBuilder' && (
          <GanttBuilderView
            report={report}
            onBack={() => setPage('report')}
          />
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-8 text-center text-xs text-slate-400">
        Your GitLab token is kept only in this browser tab&apos;s sessionStorage and never sent
        anywhere except to your GitLab instance.
      </footer>
    </div>
  );
}

export default App;
