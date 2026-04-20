import type { IssueNode, ReportResult } from '../types';

export const PROJECT_ROLE_OPTIONS = [
  { id: 'pm', label: 'PM', exportColumn: 'pmAnalytic' },
  { id: 'analytic', label: 'Analytic', exportColumn: 'pmAnalytic' },
  { id: 'leadPm', label: 'Lead PM', exportColumn: 'leadPm' },
  { id: 'lead', label: 'Lead', exportColumn: 'lead' },
  { id: 'backend', label: 'Backend developer', exportColumn: 'backend' },
  { id: 'frontend', label: 'Frontend developer', exportColumn: 'frontend' },
  { id: 'designer', label: 'Designer', exportColumn: 'designer' },
] as const;

export const PLANNING_EXPORT_COLUMNS = [
  'pmAnalytic',
  'leadPm',
  'lead',
  'backend',
  'frontend',
  'designer',
] as const;

export type ProjectRole = (typeof PROJECT_ROLE_OPTIONS)[number]['id'];
export type PlanningExportColumn = (typeof PLANNING_EXPORT_COLUMNS)[number];
export type PlanningAssignments = Record<
  string,
  Record<string, ProjectRole | null | undefined> | undefined
>;

export interface PlanningTaskHours {
  pmAnalytic: number;
  leadPm: number;
  lead: number;
  backend: number;
  frontend: number;
  designer: number;
}

export interface PlanningBoardContributor {
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  secondsInPeriod: number;
  secondsAllTime: number;
  issuesTouchedInPeriod: number;
}

export interface PlanningBoard {
  boardId: string;
  projectPath: string;
  projectName: string;
  secondsInPeriod: number;
  secondsAllTime: number;
  issuesCount: number;
  contributors: PlanningBoardContributor[];
}

export interface PlanningTaskRow {
  boardId: string;
  boardTitle: string;
  issueId: string;
  issueIid: string;
  title: string;
  depth: number;
  rowMarker: string;
  hours: PlanningTaskHours;
}

export interface PlanningAssignedPersonRole {
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  role: ProjectRole;
  secondsInPeriod: number;
  boardIds: string[];
}

const ROLE_TO_LABEL = Object.fromEntries(
  PROJECT_ROLE_OPTIONS.map((role) => [role.id, role.label])
) as Record<ProjectRole, string>;

const ROLE_TO_EXPORT_COLUMN = Object.fromEntries(
  PROJECT_ROLE_OPTIONS.map((role) => [role.id, role.exportColumn])
) as Record<ProjectRole, PlanningExportColumn>;

export function getProjectRoleLabel(role: ProjectRole) {
  return ROLE_TO_LABEL[role];
}

export function buildPlanningBoards(report: ReportResult): PlanningBoard[] {
  const boardsByProjectPath = new Map<string, PlanningBoard>();
  const seenIssueIds = new Set<string>();

  walkReportNodes(report, (node) => {
    if (seenIssueIds.has(node.issue.id)) return;
    seenIssueIds.add(node.issue.id);

    let board = boardsByProjectPath.get(node.issue.projectPath);
    if (!board) {
      board = {
        boardId: node.issue.projectPath,
        projectPath: node.issue.projectPath,
        projectName: node.issue.projectName,
        secondsInPeriod: 0,
        secondsAllTime: 0,
        issuesCount: 0,
        contributors: [],
      };
      boardsByProjectPath.set(node.issue.projectPath, board);
    }

    board.secondsInPeriod += node.totalSecondsInPeriod;
    board.secondsAllTime += node.totalSecondsAllTime;
    board.issuesCount += 1;
    mergeBoardContributors(board, node);
  });

  return Array.from(boardsByProjectPath.values())
    .filter((board) => board.secondsInPeriod > 0)
    .map((board) => ({
      ...board,
      contributors: [...board.contributors].sort(
        (left, right) =>
          right.secondsInPeriod - left.secondsInPeriod ||
          right.secondsAllTime - left.secondsAllTime ||
          left.userName.localeCompare(right.userName)
      ),
    }))
    .sort(
      (left, right) =>
        right.secondsInPeriod - left.secondsInPeriod ||
        left.projectPath.localeCompare(right.projectPath)
    );
}

export function syncPlanningAssignments(
  boards: PlanningBoard[],
  previous: PlanningAssignments
): PlanningAssignments {
  const nextAssignments: PlanningAssignments = {};

  for (const board of boards) {
    const previousBoardAssignments = previous[board.boardId] || {};
    const boardAssignments: Record<string, ProjectRole | null> = {};

    for (const contributor of board.contributors) {
      boardAssignments[contributor.userId] =
        previousBoardAssignments[contributor.userId] ?? null;
    }

    nextAssignments[board.boardId] = boardAssignments;
  }

  return nextAssignments;
}

export function getAssignedBoardRole(
  assignments: PlanningAssignments,
  boardId: string,
  userId: string
): ProjectRole | null {
  return assignments[boardId]?.[userId] ?? null;
}

export function buildPlanningAssignedPeople(
  boards: PlanningBoard[],
  assignments: PlanningAssignments
): PlanningAssignedPersonRole[] {
  const rows = new Map<string, PlanningAssignedPersonRole>();

  for (const board of boards) {
    for (const contributor of board.contributors) {
      const role = getAssignedBoardRole(assignments, board.boardId, contributor.userId);
      if (!role) continue;

      const key = `${contributor.userId}::${role}`;
      const existing = rows.get(key);
      if (existing) {
        existing.secondsInPeriod += contributor.secondsInPeriod;
        existing.boardIds.push(board.boardId);
        existing.userAvatarUrl = contributor.userAvatarUrl || existing.userAvatarUrl;
      } else {
        rows.set(key, {
          userId: contributor.userId,
          userName: contributor.userName,
          userAvatarUrl: contributor.userAvatarUrl,
          role,
          secondsInPeriod: contributor.secondsInPeriod,
          boardIds: [board.boardId],
        });
      }
    }
  }

  return Array.from(rows.values()).sort(
    (left, right) =>
      getRoleSortIndex(left.role) - getRoleSortIndex(right.role) ||
      right.secondsInPeriod - left.secondsInPeriod ||
      left.userName.localeCompare(right.userName)
  );
}

export function getPlanningMappedSeconds(
  boards: PlanningBoard[],
  assignments: PlanningAssignments
) {
  return boards.reduce(
    (total, board) => total + getPlanningBoardMappedSeconds(board, assignments),
    0
  );
}

export function getPlanningBoardMappedSeconds(
  board: PlanningBoard,
  assignments: PlanningAssignments
) {
  return board.contributors.reduce((total, contributor) => {
    if (!getAssignedBoardRole(assignments, board.boardId, contributor.userId)) return total;
    return total + contributor.secondsInPeriod;
  }, 0);
}

export function buildPlanningRoleCounts(
  boards: PlanningBoard[],
  assignments: PlanningAssignments
) {
  const counts = Object.fromEntries(
    PROJECT_ROLE_OPTIONS.map((role) => [role.id, 0])
  ) as Record<ProjectRole, number>;

  for (const board of boards) {
    for (const contributor of board.contributors) {
      const role = getAssignedBoardRole(assignments, board.boardId, contributor.userId);
      if (!role) continue;
      counts[role] += 1;
    }
  }

  return counts;
}

export function buildPlanningTaskRows(
  report: ReportResult,
  assignments: PlanningAssignments
): PlanningTaskRow[] {
  const rows: PlanningTaskRow[] = [];
  const countedIssueIds = new Set<string>();
  let topLevelIndex = 0;

  const pushNode = (node: IssueNode, depth: number) => {
    const isTopLevel = depth === 0;
    if (isTopLevel) {
      topLevelIndex += 1;
    }

    const shouldCountHours = !countedIssueIds.has(node.issue.id);
    countedIssueIds.add(node.issue.id);

    rows.push({
      boardId: node.issue.projectPath,
      boardTitle: node.issue.projectPath,
      issueId: node.issue.id,
      issueIid: node.issue.iid,
      title: node.issue.title,
      depth,
      rowMarker: isTopLevel ? String(topLevelIndex) : '-',
      hours: buildPlanningTaskHours(
        shouldCountHours ? node : null,
        assignments[node.issue.projectPath] || {}
      ),
    });

    for (const child of node.children) {
      pushNode(child, depth + 1);
    }
  };

  for (const tree of report.pmTrees) {
    for (const root of tree.pmIssues) {
      pushNode(root, 0);
    }
  }

  for (const standalone of report.standalone) {
    pushNode(standalone, 0);
  }

  return rows;
}

export function sumPlanningTaskHours(rows: PlanningTaskRow[]) {
  return rows.reduce(
    (totals, row) => ({
      pmAnalytic: roundHours(totals.pmAnalytic + row.hours.pmAnalytic),
      leadPm: roundHours(totals.leadPm + row.hours.leadPm),
      lead: roundHours(totals.lead + row.hours.lead),
      backend: roundHours(totals.backend + row.hours.backend),
      frontend: roundHours(totals.frontend + row.hours.frontend),
      designer: roundHours(totals.designer + row.hours.designer),
    }),
    createEmptyPlanningTaskHours()
  );
}

export function createEmptyPlanningTaskHours(): PlanningTaskHours {
  return {
    pmAnalytic: 0,
    leadPm: 0,
    lead: 0,
    backend: 0,
    frontend: 0,
    designer: 0,
  };
}

function buildPlanningTaskHours(
  node: IssueNode | null,
  boardAssignments: Record<string, ProjectRole | null | undefined>
): PlanningTaskHours {
  if (!node) {
    return createEmptyPlanningTaskHours();
  }

  const totalsInSeconds = Object.fromEntries(
    PLANNING_EXPORT_COLUMNS.map((column) => [column, 0])
  ) as Record<PlanningExportColumn, number>;

  for (const user of node.users) {
    const role = boardAssignments[user.userId];
    if (!role || user.secondsInPeriod <= 0) continue;
    totalsInSeconds[ROLE_TO_EXPORT_COLUMN[role]] += user.secondsInPeriod;
  }

  return {
    pmAnalytic: roundHours(totalsInSeconds.pmAnalytic / 3600),
    leadPm: roundHours(totalsInSeconds.leadPm / 3600),
    lead: roundHours(totalsInSeconds.lead / 3600),
    backend: roundHours(totalsInSeconds.backend / 3600),
    frontend: roundHours(totalsInSeconds.frontend / 3600),
    designer: roundHours(totalsInSeconds.designer / 3600),
  };
}

function walkReportNodes(report: ReportResult, visitor: (node: IssueNode) => void) {
  const visit = (node: IssueNode) => {
    visitor(node);
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const tree of report.pmTrees) {
    for (const node of tree.pmIssues) {
      visit(node);
    }
  }

  for (const node of report.standalone) {
    visit(node);
  }
}

function mergeBoardContributors(board: PlanningBoard, node: IssueNode) {
  const contributorsByUserId = new Map(board.contributors.map((contributor) => [contributor.userId, contributor]));

  for (const user of node.users) {
    if (user.secondsInPeriod <= 0) continue;

    const existing = contributorsByUserId.get(user.userId);
    if (existing) {
      existing.secondsInPeriod += user.secondsInPeriod;
      existing.secondsAllTime += user.secondsAllTime;
      existing.userAvatarUrl = user.userAvatarUrl || existing.userAvatarUrl;
      existing.issuesTouchedInPeriod += 1;
    } else {
      const contributor: PlanningBoardContributor = {
        userId: user.userId,
        userName: user.userName,
        userAvatarUrl: user.userAvatarUrl,
        secondsInPeriod: user.secondsInPeriod,
        secondsAllTime: user.secondsAllTime,
        issuesTouchedInPeriod: 1,
      };
      board.contributors.push(contributor);
      contributorsByUserId.set(contributor.userId, contributor);
    }
  }
}

function getRoleSortIndex(role: ProjectRole) {
  return PROJECT_ROLE_OPTIONS.findIndex((candidate) => candidate.id === role);
}

function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}
