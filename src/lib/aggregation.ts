import type {
  IssueNode,
  PersonAggregation,
  RawIssue,
  ReportResult,
  TreeRollup,
  UserAggregation,
} from '../types';
import { getPeriodBounds, isTimestampInPeriod, type PeriodBounds } from './time';
import type { BuildLogger } from './logger';

interface IssueSummary {
  issue: RawIssue;
  totalSecondsAllTime: number;
  totalSecondsInPeriod: number;
  users: UserAggregation[];
  hasPeriodActivity: boolean;
}

export function buildReport(
  issues: RawIssue[],
  projectPath: string,
  startDate: string,
  endDate: string,
  logger?: BuildLogger
): ReportResult {
  logger?.phase('Starting aggregation', {
    totalIssues: issues.length,
    projectPath,
    period: `${startDate} - ${endDate}`,
  });

  const periodBounds = getPeriodBounds(startDate, endDate);
  const summaries = new Map<string, IssueSummary>();
  for (const issue of issues) {
    summaries.set(issue.id, summarizeIssue(issue, periodBounds));
  }
  logger?.info(`Precomputed summaries for ${summaries.size} issues`);

  const pmRoots = issues.filter((i) => i.projectPath === projectPath);
  const pmRootIds = new Set(pmRoots.map((i) => i.id));
  logger?.info(`Identified ${pmRoots.length} PM root issues in project ${projectPath}`);

  const issuesInTrees = new Set<string>();
  for (const root of pmRoots) {
    issuesInTrees.add(root.id);
    for (const linkedId of root.linkedIssueIds) {
      issuesInTrees.add(linkedId);
    }
  }
  logger?.info(`${issuesInTrees.size} issues are part of PM trees (roots + linked children)`);

  const parentsByChild = new Map<string, Set<string>>();
  for (const root of pmRoots) {
    for (const childId of root.linkedIssueIds) {
      if (!parentsByChild.has(childId)) parentsByChild.set(childId, new Set());
      parentsByChild.get(childId)!.add(root.id);
    }
  }

  const treeHasPeriodActivity = new Map<string, boolean>();
  for (const root of pmRoots) {
    const hasActivity =
      (summaries.get(root.id)?.hasPeriodActivity ?? false) ||
      root.linkedIssueIds.some((id) => summaries.get(id)?.hasPeriodActivity ?? false);
    treeHasPeriodActivity.set(root.id, hasActivity);
  }

  const pmTrees: IssueNode[] = [];
  for (const root of pmRoots) {
    if (!treeHasPeriodActivity.get(root.id)) continue;

    const rootSummary = summaries.get(root.id);
    if (!rootSummary) continue;

    const children: IssueNode[] = [];
    for (const linkedId of root.linkedIssueIds) {
      const childSummary = summaries.get(linkedId);
      if (!childSummary) continue;
      children.push(
        buildNode(childSummary, {
          isShared: (parentsByChild.get(childSummary.issue.id)?.size || 0) > 1,
        })
      );
    }

    pmTrees.push({
      ...buildNode(rootSummary, { isShared: false }),
      children,
    });
  }
  logger?.info(`Built ${pmTrees.length} PM trees with period activity`);

  const standalone: IssueNode[] = [];
  for (const issue of issues) {
    if (pmRootIds.has(issue.id)) continue;
    if (issuesInTrees.has(issue.id)) continue;

    const summary = summaries.get(issue.id);
    if (!summary?.hasPeriodActivity) continue;
    standalone.push(buildNode(summary, { isShared: false }));
  }
  logger?.info(`Found ${standalone.length} standalone issues with period activity`);

  const uniqueIssuesInPeriod = new Set<string>();
  const uniqueUsersInPeriod = new Set<string>();
  let totalSecondsInPeriod = 0;

  const walk = (node: IssueNode) => {
    if (node.totalSecondsInPeriod > 0) {
      uniqueIssuesInPeriod.add(node.issue.id);
      totalSecondsInPeriod += node.totalSecondsInPeriod;
      for (const u of node.users) {
        if (u.secondsInPeriod > 0) uniqueUsersInPeriod.add(u.userId);
      }
    }
    for (const c of node.children) walk(c);
  };
  for (const t of pmTrees) walk(t);
  for (const s of standalone) walk(s);

  const treeRollups: Record<string, TreeRollup> = {};
  for (const tree of pmTrees) {
    treeRollups[tree.issue.id] = computeTreeRollup(tree);
  }

  const grandTotal = computeGrandTotal(pmTrees, standalone);
  logger?.success(
    `Grand total: ${formatSeconds(grandTotal.secondsInPeriod)} in period, ${formatSeconds(grandTotal.secondsAllTime)} all time`
  );

  const people = computePeople(pmTrees, standalone, grandTotal.secondsInPeriod);
  logger?.success(`Aggregated ${people.length} contributors in People view`);

  logger?.phase('Aggregation complete', {
    trees: pmTrees.length,
    standalone: standalone.length,
    issuesWithActivity: uniqueIssuesInPeriod.size,
    users: uniqueUsersInPeriod.size,
  });

  return {
    pmTrees,
    standalone,
    treeRollups,
    grandTotal,
    people,
    totals: {
      issuesInPeriod: uniqueIssuesInPeriod.size,
      usersInPeriod: uniqueUsersInPeriod.size,
      secondsInPeriod: totalSecondsInPeriod,
    },
    warnings: [],
    period: { start: startDate, end: endDate },
    projectPath,
  };
}

function computeTreeRollup(tree: IssueNode): TreeRollup {
  let secondsInPeriod = 0;
  let secondsAllTime = 0;
  const userMap = new Map<string, UserAggregation>();
  const seenIssues = new Set<string>();

  const visit = (node: IssueNode) => {
    if (seenIssues.has(node.issue.id)) return;
    seenIssues.add(node.issue.id);
    secondsInPeriod += node.totalSecondsInPeriod;
    secondsAllTime += node.totalSecondsAllTime;
    for (const u of node.users) {
      const existing = userMap.get(u.userId);
      if (existing) {
        existing.secondsInPeriod += u.secondsInPeriod;
        existing.secondsAllTime += u.secondsAllTime;
        existing.userAvatarUrl = u.userAvatarUrl || existing.userAvatarUrl;
      } else {
        userMap.set(u.userId, { ...u });
      }
    }
    for (const c of node.children) visit(c);
  };
  visit(tree);

  const users = Array.from(userMap.values()).sort(
    (a, b) => b.secondsInPeriod - a.secondsInPeriod || b.secondsAllTime - a.secondsAllTime
  );

  return {
    rootIssueId: tree.issue.id,
    secondsInPeriod,
    secondsAllTime,
    issuesCount: seenIssues.size,
    users,
  };
}

function computeGrandTotal(pmTrees: IssueNode[], standalone: IssueNode[]) {
  let secondsInPeriod = 0;
  let secondsAllTime = 0;
  const userMap = new Map<string, UserAggregation>();
  const seen = new Set<string>();

  const visit = (node: IssueNode) => {
    if (seen.has(node.issue.id)) return;
    seen.add(node.issue.id);
    secondsInPeriod += node.totalSecondsInPeriod;
    secondsAllTime += node.totalSecondsAllTime;
    for (const u of node.users) {
      const existing = userMap.get(u.userId);
      if (existing) {
        existing.secondsInPeriod += u.secondsInPeriod;
        existing.secondsAllTime += u.secondsAllTime;
        existing.userAvatarUrl = u.userAvatarUrl || existing.userAvatarUrl;
      } else {
        userMap.set(u.userId, { ...u });
      }
    }
    for (const c of node.children) visit(c);
  };

  for (const t of pmTrees) visit(t);
  for (const s of standalone) visit(s);

  const users = Array.from(userMap.values()).sort(
    (a, b) => b.secondsInPeriod - a.secondsInPeriod || b.secondsAllTime - a.secondsAllTime
  );

  return { secondsInPeriod, secondsAllTime, users };
}

function computePeople(
  pmTrees: IssueNode[],
  standalone: IssueNode[],
  grandTotalSecondsInPeriod: number
): PersonAggregation[] {
  const peopleMap = new Map<string, PersonAggregation>();
  const seenIssueIds = new Set<string>();

  const visit = (node: IssueNode) => {
    if (seenIssueIds.has(node.issue.id)) return;
    seenIssueIds.add(node.issue.id);

    for (const u of node.users) {
      let person = peopleMap.get(u.userId);
      if (!person) {
        person = {
          userId: u.userId,
          userName: u.userName,
          userAvatarUrl: u.userAvatarUrl,
          secondsInPeriod: 0,
          secondsAllTime: 0,
          issuesTouchedInPeriod: 0,
          sharePercent: 0,
          issueBreakdown: [],
        };
        peopleMap.set(u.userId, person);
      }
      person.secondsInPeriod += u.secondsInPeriod;
      person.secondsAllTime += u.secondsAllTime;
      person.userAvatarUrl = u.userAvatarUrl || person.userAvatarUrl;
      if (u.secondsInPeriod > 0) {
        person.issuesTouchedInPeriod += 1;
        person.issueBreakdown.push({
          issueId: node.issue.id,
          issueIid: node.issue.iid,
          issueTitle: node.issue.title,
          issueWebUrl: node.issue.webUrl,
          projectName: node.issue.projectName,
          secondsInPeriod: u.secondsInPeriod,
        });
      }
    }

    for (const c of node.children) visit(c);
  };

  for (const t of pmTrees) visit(t);
  for (const s of standalone) visit(s);

  const people = Array.from(peopleMap.values());
  for (const p of people) {
    p.sharePercent =
      grandTotalSecondsInPeriod > 0
        ? (p.secondsInPeriod / grandTotalSecondsInPeriod) * 100
        : 0;
    p.issueBreakdown.sort((a, b) => b.secondsInPeriod - a.secondsInPeriod);
  }

  return people.sort(
    (a, b) => b.secondsInPeriod - a.secondsInPeriod || b.secondsAllTime - a.secondsAllTime
  );
}

function summarizeIssue(issue: RawIssue, periodBounds: PeriodBounds): IssueSummary {
  const userMap = new Map<string, UserAggregation>();
  let totalSecondsInPeriod = 0;
  let derivedAllTime = 0;

  for (const entry of issue.timelogs) {
    const inPeriod = isTimestampInPeriod(new Date(entry.spentAt).getTime(), periodBounds);
    let agg = userMap.get(entry.userId);
    if (!agg) {
      agg = {
        userId: entry.userId,
        userName: entry.userName,
        userAvatarUrl: entry.userAvatarUrl,
        secondsInPeriod: 0,
        secondsAllTime: 0,
      };
      userMap.set(entry.userId, agg);
    }
    derivedAllTime += entry.timeSpentSeconds;
    agg.secondsAllTime += entry.timeSpentSeconds;
    if (inPeriod) {
      agg.secondsInPeriod += entry.timeSpentSeconds;
      totalSecondsInPeriod += entry.timeSpentSeconds;
    }
    agg.userName = entry.userName;
    agg.userAvatarUrl = entry.userAvatarUrl || agg.userAvatarUrl;
  }

  const totalSecondsAllTime = issue.totalTimeSpentSeconds || derivedAllTime;
  const users = Array.from(userMap.values()).sort(
    (a, b) => b.secondsInPeriod - a.secondsInPeriod || b.secondsAllTime - a.secondsAllTime
  );

  return {
    issue,
    totalSecondsAllTime,
    totalSecondsInPeriod,
    users,
    hasPeriodActivity: totalSecondsInPeriod > 0,
  };
}

function buildNode(summary: IssueSummary, opts: { isShared: boolean }): IssueNode {
  return {
    issue: summary.issue,
    totalSecondsAllTime: summary.totalSecondsAllTime,
    totalSecondsInPeriod: summary.totalSecondsInPeriod,
    users: summary.users,
    children: [],
    isContextOnly: summary.totalSecondsInPeriod === 0,
    isShared: opts.isShared,
  };
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
