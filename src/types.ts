export interface GitLabUser {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
}

export interface TimeEntry {
  id: string;
  issueId: string;
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  timeSpentSeconds: number;
  spentAt: string;
}

export interface RawIssue {
  id: string;
  iid: string;
  title: string;
  webUrl: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  totalTimeSpentSeconds: number;
  timelogs: TimeEntry[];
  linkedIssueIds: string[];
}

export interface UserAggregation {
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  secondsInPeriod: number;
  secondsAllTime: number;
}

export interface IssueNode {
  issue: RawIssue;
  totalSecondsAllTime: number;
  totalSecondsInPeriod: number;
  users: UserAggregation[];
  children: IssueNode[];
  isContextOnly: boolean;
  isShared: boolean;
}

export interface TreeRollup {
  rootIssueId: string;
  secondsInPeriod: number;
  secondsAllTime: number;
  issuesCount: number;
  users: UserAggregation[];
}

export interface PersonAggregation {
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  secondsInPeriod: number;
  secondsAllTime: number;
  issuesTouchedInPeriod: number;
  sharePercent: number;
  issueBreakdown: {
    issueId: string;
    issueIid: string;
    issueTitle: string;
    issueWebUrl: string;
    projectName: string;
    secondsInPeriod: number;
  }[];
}

export interface ReportResult {
  pmTrees: IssueNode[];
  standalone: IssueNode[];
  treeRollups: Record<string, TreeRollup>;
  grandTotal: {
    secondsInPeriod: number;
    secondsAllTime: number;
    users: UserAggregation[];
  };
  people: PersonAggregation[];
  totals: {
    issuesInPeriod: number;
    usersInPeriod: number;
    secondsInPeriod: number;
  };
  warnings: string[];
  period: { start: string; end: string };
  projectPath: string;
}

export interface FilterFormValues {
  instanceUrl: string;
  token: string;
  projectPath: string;
  startDate: string;
  endDate: string;
}
