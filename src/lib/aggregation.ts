import type {
  IssueNode,
  PersonAggregation,
  PmTree,
  RawIssue,
  ReportResult,
  TreeRollup,
  UserAggregation,
} from '../types';
import { isInPeriod } from './time';
import type { BuildLogger } from './logger';

interface IssueSummary {
  issue: RawIssue;
  totalSecondsAllTime: number;
  totalSecondsInPeriod: number;
  users: UserAggregation[];
  hasPeriodActivity: boolean;
}

interface PmComponent {
  pmIssueIds: string[];
}

export function buildReport(
  issues: RawIssue[],
  projectPath: string,
  startDate: string,
  endDate: string,
  warnings: string[] = [],
  logger?: BuildLogger
): ReportResult {
  logger?.phase('Starting aggregation', {
    totalIssues: issues.length,
    projectPath,
    period: `${startDate} - ${endDate}`,
  });

  const summaries = new Map<string, IssueSummary>();
  for (const issue of issues) {
    summaries.set(issue.id, summarizeIssue(issue, startDate, endDate));
  }
  logger?.info(`Precomputed summaries for ${summaries.size} issues`);

  const pmIssues = issues.filter((issue) => issue.projectPath === projectPath);
  const pmIssueIds = new Set(pmIssues.map((issue) => issue.id));
  const pmComponents = buildPmComponents(pmIssues, pmIssueIds);
  logger?.info(
    `Resolved ${pmComponents.length} PM cluster(s) from ${pmIssues.length} issue(s) in ${projectPath}`
  );

  const parentsByChild = buildParentsByChild(pmIssues, pmIssueIds);
  const issuesInTrees = new Set<string>();
  const pmTrees: PmTree[] = [];

  for (const component of pmComponents) {
    const componentPmIssueIds = new Set(component.pmIssueIds);
    const branchIssueIds = new Set<string>();
    let hasActivity = false;

    for (const pmIssueId of component.pmIssueIds) {
      const summary = summaries.get(pmIssueId);
      if (summary?.hasPeriodActivity) hasActivity = true;

      const linkedIssueIds = summary?.issue.linkedIssueIds || [];
      for (const linkedIssueId of linkedIssueIds) {
        if (componentPmIssueIds.has(linkedIssueId)) continue;
        branchIssueIds.add(linkedIssueId);
        if (summaries.get(linkedIssueId)?.hasPeriodActivity) {
          hasActivity = true;
        }
      }
    }

    if (!hasActivity) continue;

    const pmNodes: IssueNode[] = [];
    for (const pmIssueId of component.pmIssueIds) {
      const summary = summaries.get(pmIssueId);
      if (!summary) continue;

      const uniqueChildren = new Set<string>();
      const children: IssueNode[] = [];
      for (const linkedIssueId of summary.issue.linkedIssueIds) {
        if (componentPmIssueIds.has(linkedIssueId) || uniqueChildren.has(linkedIssueId)) continue;
        uniqueChildren.add(linkedIssueId);

        const childSummary = summaries.get(linkedIssueId);
        if (!childSummary) continue;

        children.push(
          buildNode(childSummary, {
            isShared: (parentsByChild.get(linkedIssueId)?.size || 0) > 1,
          })
        );
      }

      pmNodes.push({
        ...buildNode(summary, { isShared: false }),
        children,
      });
    }

    if (pmNodes.length === 0) continue;

    for (const pmIssueId of component.pmIssueIds) {
      issuesInTrees.add(pmIssueId);
    }
    for (const branchIssueId of branchIssueIds) {
      issuesInTrees.add(branchIssueId);
    }

    pmTrees.push({
      treeId: makeTreeId(component.pmIssueIds),
      rootIssueIds: [...component.pmIssueIds],
      pmIssues: pmNodes,
    });
  }

  logger?.info(`Built ${pmTrees.length} PM cluster(s) with period activity`);

  const standalone: IssueNode[] = [];
  for (const issue of issues) {
    if (issuesInTrees.has(issue.id)) continue;

    const summary = summaries.get(issue.id);
    if (!summary?.hasPeriodActivity) continue;
    standalone.push(buildNode(summary, { isShared: false }));
  }
  logger?.info(`Found ${standalone.length} standalone issues with period activity`);

  const uniqueIssuesInPeriod = new Set<string>();
  const uniqueUsersInPeriod = new Set<string>();
  let totalSecondsInPeriod = 0;

  walkAllNodes(pmTrees, standalone, (node) => {
    if (node.totalSecondsInPeriod <= 0) return;

    uniqueIssuesInPeriod.add(node.issue.id);
    totalSecondsInPeriod += node.totalSecondsInPeriod;
    for (const user of node.users) {
      if (user.secondsInPeriod > 0) {
        uniqueUsersInPeriod.add(user.userId);
      }
    }
  });

  const treeRollups: Record<string, TreeRollup> = {};
  for (const tree of pmTrees) {
    treeRollups[tree.treeId] = computeTreeRollup(tree);
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
    warnings,
    period: { start: startDate, end: endDate },
    projectPath,
  };
}

function buildPmComponents(pmIssues: RawIssue[], pmIssueIds: Set<string>): PmComponent[] {
  const orderByIssueId = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  pmIssues.forEach((issue, index) => {
    orderByIssueId.set(issue.id, index);
    adjacency.set(issue.id, new Set());
  });

  for (const issue of pmIssues) {
    for (const linkedIssueId of issue.linkedIssueIds) {
      if (!pmIssueIds.has(linkedIssueId)) continue;
      adjacency.get(issue.id)?.add(linkedIssueId);
      adjacency.get(linkedIssueId)?.add(issue.id);
    }
  }

  const visited = new Set<string>();
  const components: PmComponent[] = [];

  for (const issue of pmIssues) {
    if (visited.has(issue.id)) continue;

    const stack = [issue.id];
    const pmIssueIdsInComponent: string[] = [];
    visited.add(issue.id);

    while (stack.length > 0) {
      const currentIssueId = stack.pop()!;
      pmIssueIdsInComponent.push(currentIssueId);

      for (const linkedPmIssueId of adjacency.get(currentIssueId) || []) {
        if (visited.has(linkedPmIssueId)) continue;
        visited.add(linkedPmIssueId);
        stack.push(linkedPmIssueId);
      }
    }

    pmIssueIdsInComponent.sort(
      (left, right) =>
        (orderByIssueId.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (orderByIssueId.get(right) ?? Number.MAX_SAFE_INTEGER)
    );

    components.push({ pmIssueIds: pmIssueIdsInComponent });
  }

  return components;
}

function buildParentsByChild(pmIssues: RawIssue[], pmIssueIds: Set<string>) {
  const parentsByChild = new Map<string, Set<string>>();

  for (const pmIssue of pmIssues) {
    for (const childId of pmIssue.linkedIssueIds) {
      if (pmIssueIds.has(childId)) continue;
      if (!parentsByChild.has(childId)) parentsByChild.set(childId, new Set());
      parentsByChild.get(childId)!.add(pmIssue.id);
    }
  }

  return parentsByChild;
}

function computeTreeRollup(tree: PmTree): TreeRollup {
  let secondsInPeriod = 0;
  let secondsAllTime = 0;
  const userMap = new Map<string, UserAggregation>();
  const seenIssues = new Set<string>();

  visitIssueRoots(tree.pmIssues, (node) => {
    if (seenIssues.has(node.issue.id)) return;
    seenIssues.add(node.issue.id);

    secondsInPeriod += node.totalSecondsInPeriod;
    secondsAllTime += node.totalSecondsAllTime;
    mergeUsers(userMap, node.users);
  });

  const users = sortUsers(userMap);

  return {
    treeId: tree.treeId,
    rootIssueIds: tree.rootIssueIds,
    secondsInPeriod,
    secondsAllTime,
    issuesCount: seenIssues.size,
    users,
  };
}

function computeGrandTotal(pmTrees: PmTree[], standalone: IssueNode[]) {
  let secondsInPeriod = 0;
  let secondsAllTime = 0;
  const userMap = new Map<string, UserAggregation>();
  const seenIssues = new Set<string>();

  walkAllNodes(pmTrees, standalone, (node) => {
    if (seenIssues.has(node.issue.id)) return;
    seenIssues.add(node.issue.id);

    secondsInPeriod += node.totalSecondsInPeriod;
    secondsAllTime += node.totalSecondsAllTime;
    mergeUsers(userMap, node.users);
  });

  return {
    secondsInPeriod,
    secondsAllTime,
    users: sortUsers(userMap),
  };
}

function computePeople(
  pmTrees: PmTree[],
  standalone: IssueNode[],
  grandTotalSecondsInPeriod: number
): PersonAggregation[] {
  const peopleMap = new Map<string, PersonAggregation>();
  const seenIssueIds = new Set<string>();

  walkAllNodes(pmTrees, standalone, (node) => {
    if (seenIssueIds.has(node.issue.id)) return;
    seenIssueIds.add(node.issue.id);

    for (const user of node.users) {
      let person = peopleMap.get(user.userId);
      if (!person) {
        person = {
          userId: user.userId,
          userName: user.userName,
          userAvatarUrl: user.userAvatarUrl,
          secondsInPeriod: 0,
          secondsAllTime: 0,
          issuesTouchedInPeriod: 0,
          sharePercent: 0,
          issueBreakdown: [],
        };
        peopleMap.set(user.userId, person);
      }

      person.secondsInPeriod += user.secondsInPeriod;
      person.secondsAllTime += user.secondsAllTime;
      person.userAvatarUrl = user.userAvatarUrl || person.userAvatarUrl;

      if (user.secondsInPeriod > 0) {
        person.issuesTouchedInPeriod += 1;
        person.issueBreakdown.push({
          issueId: node.issue.id,
          issueIid: node.issue.iid,
          issueTitle: node.issue.title,
          issueWebUrl: node.issue.webUrl,
          projectName: node.issue.projectName,
          secondsInPeriod: user.secondsInPeriod,
        });
      }
    }
  });

  const people = Array.from(peopleMap.values());
  for (const person of people) {
    person.sharePercent =
      grandTotalSecondsInPeriod > 0
        ? (person.secondsInPeriod / grandTotalSecondsInPeriod) * 100
        : 0;
    person.issueBreakdown.sort((left, right) => right.secondsInPeriod - left.secondsInPeriod);
  }

  return people.sort(
    (left, right) =>
      right.secondsInPeriod - left.secondsInPeriod ||
      right.secondsAllTime - left.secondsAllTime
  );
}

function summarizeIssue(issue: RawIssue, startDate: string, endDate: string): IssueSummary {
  const userMap = new Map<string, UserAggregation>();
  let totalSecondsInPeriod = 0;
  let derivedAllTime = 0;

  for (const entry of issue.timelogs) {
    const inPeriod = isInPeriod(entry.spentAt, startDate, endDate);
    let aggregation = userMap.get(entry.userId);

    if (!aggregation) {
      aggregation = {
        userId: entry.userId,
        userName: entry.userName,
        userAvatarUrl: entry.userAvatarUrl,
        secondsInPeriod: 0,
        secondsAllTime: 0,
      };
      userMap.set(entry.userId, aggregation);
    }

    derivedAllTime += entry.timeSpentSeconds;
    aggregation.secondsAllTime += entry.timeSpentSeconds;
    if (inPeriod) {
      aggregation.secondsInPeriod += entry.timeSpentSeconds;
      totalSecondsInPeriod += entry.timeSpentSeconds;
    }
    aggregation.userName = entry.userName;
    aggregation.userAvatarUrl = entry.userAvatarUrl || aggregation.userAvatarUrl;
  }

  const totalSecondsAllTime = issue.totalTimeSpentSeconds || derivedAllTime;
  const users = Array.from(userMap.values()).sort(
    (left, right) =>
      right.secondsInPeriod - left.secondsInPeriod ||
      right.secondsAllTime - left.secondsAllTime
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

function walkAllNodes(
  pmTrees: PmTree[],
  standalone: IssueNode[],
  visitor: (node: IssueNode) => void
) {
  for (const tree of pmTrees) {
    visitIssueRoots(tree.pmIssues, visitor);
  }
  for (const node of standalone) {
    visitIssueNode(node, visitor);
  }
}

function visitIssueRoots(nodes: IssueNode[], visitor: (node: IssueNode) => void) {
  for (const node of nodes) {
    visitIssueNode(node, visitor);
  }
}

function visitIssueNode(node: IssueNode, visitor: (node: IssueNode) => void) {
  visitor(node);
  for (const child of node.children) {
    visitIssueNode(child, visitor);
  }
}

function mergeUsers(target: Map<string, UserAggregation>, users: UserAggregation[]) {
  for (const user of users) {
    const existing = target.get(user.userId);
    if (existing) {
      existing.secondsInPeriod += user.secondsInPeriod;
      existing.secondsAllTime += user.secondsAllTime;
      existing.userAvatarUrl = user.userAvatarUrl || existing.userAvatarUrl;
    } else {
      target.set(user.userId, { ...user });
    }
  }
}

function sortUsers(userMap: Map<string, UserAggregation>) {
  return Array.from(userMap.values()).sort(
    (left, right) =>
      right.secondsInPeriod - left.secondsInPeriod ||
      right.secondsAllTime - left.secondsAllTime
  );
}

function makeTreeId(pmIssueIds: string[]) {
  return `pm-cluster:${pmIssueIds.join('|')}`;
}

function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
