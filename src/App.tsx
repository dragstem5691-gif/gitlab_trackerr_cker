import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Play, Sparkles } from 'lucide-react';
import { FilterForm } from './components/FilterForm';
import { ReportView } from './components/ReportView';
import { BuildLog } from './components/BuildLog';
import { PlanningBuilderView } from './components/PlanningBuilderView';
import { GanttBuilderView } from './components/GanttBuilderView';
import { AppShell } from './components/AppShell';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { ActivityDrawer } from './components/ActivityDrawer';
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
import type { AppPage } from './lib/navigation';
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
  const [page, setPage] = useState<AppPage>('report');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formSnapshot, setFormSnapshot] = useState<FilterFormValues>(initial);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [planningAssignments, setPlanningAssignments] = useState<PlanningAssignments>({});
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
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

  const ganttGitLabConfig = useMemo(() => {
    if (!report || !formSnapshot.token) return null;
    const instanceOrigin = parseInstanceOrigin(formSnapshot.instanceUrl);
    const mainScopePath = parseProjectPath(formSnapshot.instanceUrl);
    if (!instanceOrigin || !mainScopePath) return null;
    return {
      instanceOrigin,
      token: formSnapshot.token,
      mainScopePath,
      pmProjectPath: report.projectPath,
    };
  }, [formSnapshot.instanceUrl, formSnapshot.token, report]);

  const runReport = async (values: FilterFormValues) => {
    setIsDemo(false);
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

  const handleSubmit = (values: FilterFormValues) => {
    setConnectionOpen(false);
    void runReport(values);
  };

  const handleDemo = () => {
    setConnectionOpen(false);
    setIsDemo(true);
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
    setIsDemo(false);
    setConnectionOpen(true);
  };

  const canOpenReport = !!report || loading;
  const canOpenPlanning = !!report;

  useEffect(() => {
    if (page === 'planning' && !canOpenPlanning) {
      setPage(canOpenReport ? 'report' : 'ganttBuilder');
    }
  }, [page, canOpenReport, canOpenPlanning]);

  const gitLabStatus: 'connected' | 'disconnected' | 'demo' = isDemo
    ? 'demo'
    : report && formSnapshot.token
    ? 'connected'
    : 'disconnected';

  const gitLabLabel = isDemo
    ? 'Demo dataset'
    : report
    ? report.projectPath
    : formSnapshot.projectPath
    ? 'Not synced'
    : 'Not connected';

  const breadcrumb = useMemo(() => {
    const crumbs: string[] = [];
    if (page === 'report') crumbs.push('Report');
    if (page === 'planning') crumbs.push('Report', 'Planning');
    if (page === 'ganttBuilder') crumbs.push('Gantt Builder');
    if (report && page !== 'ganttBuilder') crumbs.push(report.projectPath);
    return crumbs;
  }, [page, report]);

  const commandActions: CommandAction[] = useMemo(
    () => [
      {
        id: 'nav.report',
        label: 'Go to Report',
        hint: 'View time tracking report',
        shortcut: 'Alt+1',
        disabled: !canOpenReport,
        onRun: () => setPage('report'),
      },
      {
        id: 'nav.planning',
        label: 'Go to Planning',
        hint: 'Assign people to boards',
        shortcut: 'Alt+2',
        disabled: !canOpenPlanning,
        onRun: () => setPage('planning'),
      },
      {
        id: 'nav.gantt',
        label: 'Go to Gantt Builder',
        hint: 'Build and edit the Gantt plan',
        shortcut: 'Alt+3',
        onRun: () => setPage('ganttBuilder'),
      },
      {
        id: 'action.connect',
        label: 'Connect to GitLab',
        hint: 'Open connection panel',
        onRun: () => {
          setPage('report');
          setConnectionOpen(true);
        },
      },
      {
        id: 'action.demo',
        label: 'Load demo dataset',
        hint: 'Explore the app without a GitLab token',
        onRun: handleDemo,
      },
      {
        id: 'action.reset',
        label: 'Reset report',
        hint: 'Start a new report',
        disabled: !report && !isDemo,
        onRun: handleReset,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canOpenReport, canOpenPlanning, report, isDemo]
  );

  const hasLogs = logEntries.length > 0 || loading;

  return (
    <AppShell
      page={page}
      onChangePage={setPage}
      canOpenReport={canOpenReport}
      canOpenPlanning={canOpenPlanning}
      breadcrumb={breadcrumb}
      gitLabStatus={gitLabStatus}
      gitLabLabel={gitLabLabel}
      onOpenConnection={() => {
        setPage('report');
        setConnectionOpen(true);
      }}
      onOpenCommandPalette={() => setPaletteOpen(true)}
    >
      <main
        className={`mx-auto px-4 py-6 sm:px-6 ${
          page === 'ganttBuilder' ? 'max-w-[1440px] space-y-5' : 'max-w-6xl space-y-6'
        } ${hasLogs ? 'pb-24' : ''}`}
      >
        {page === 'report' && !report && !loading && !connectionOpen && (
          <EmptyReport
            onConnect={() => setConnectionOpen(true)}
            onDemo={handleDemo}
            onOpenBuilder={() => setPage('ganttBuilder')}
          />
        )}

        {page === 'report' && (connectionOpen || loading || error) && !report && (
          <FilterForm
            initialValues={formSnapshot}
            onSubmit={handleSubmit}
            onDemo={handleDemo}
            isLoading={loading}
            error={error}
          />
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
            gitLabConfig={ganttGitLabConfig}
            onBack={() => setPage(report ? 'report' : 'ganttBuilder')}
          />
        )}
      </main>

      {hasLogs && (
        <ActivityDrawer
          title="Activity"
          subtitle={loading ? 'Running build...' : `${logEntries.length} log entries`}
          badge={logEntries.length}
          defaultOpen={loading}
        >
          <BuildLog entries={logEntries} isRunning={loading} defaultOpen={true} />
        </ActivityDrawer>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={commandActions}
      />
    </AppShell>
  );
}

function EmptyReport({
  onConnect,
  onDemo,
  onOpenBuilder,
}: {
  onConnect: () => void;
  onDemo: () => void;
  onOpenBuilder: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-10 sm:p-14 text-center max-w-3xl mx-auto">
      <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 text-white mb-5">
        <Sparkles className="w-6 h-6" />
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
        Build a clean time report in seconds
      </h2>
      <p className="mt-3 text-slate-600">
        Connect a GitLab project and pick a date range to see tracked hours per person, per issue,
        and across linked subprojects. Or jump straight into the Gantt Builder to plan manually.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onConnect}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800"
        >
          <Play className="w-4 h-4" />
          Connect to GitLab
        </button>
        <button
          type="button"
          onClick={onDemo}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          Try demo dataset
        </button>
        <button
          type="button"
          onClick={onOpenBuilder}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          <CalendarRange className="w-4 h-4" />
          Open Gantt Builder
        </button>
      </div>
    </div>
  );
}

export default App;
