import type { RawIssue } from '../types';

const U1 = { id: 'gid://gitlab/User/101', name: 'Ivan P.' };
const U2 = { id: 'gid://gitlab/User/102', name: 'Maria Sidorova' };
const U3 = { id: 'gid://gitlab/User/103', name: 'Alex Doe' };

function entry(
  id: string,
  issueId: string,
  user: { id: string; name: string },
  hours: number,
  spentAt: string,
  summary?: string
) {
  return {
    id,
    issueId,
    userId: user.id,
    userName: user.name,
    userAvatarUrl: undefined,
    timeSpentSeconds: hours * 3600,
    spentAt,
    summary,
  };
}

export const DEMO_PROJECT_PATH = 'group/project-pm';

export const DEMO_ISSUES: RawIssue[] = [
  {
    id: 'gid://gitlab/Issue/PM-101',
    iid: '101',
    title: 'Main initiative A',
    webUrl: 'https://gitlab.example.com/group/project-pm/-/issues/101',
    projectId: 'gid://gitlab/Project/1',
    projectName: 'project-pm',
    projectPath: 'group/project-pm',
    totalTimeSpentSeconds: 5 * 3600,
    timelogs: [
      entry('t-pm101-1', 'gid://gitlab/Issue/PM-101', U3, 2, '2026-04-02T10:00:00+05:00', 'Prepared PM plan'),
      entry('t-pm101-2', 'gid://gitlab/Issue/PM-101', U3, 3, '2026-04-11T10:00:00+05:00'),
    ],
    linkedIssueIds: [
      'gid://gitlab/Issue/PM-102',
      'gid://gitlab/Issue/BE-201',
      'gid://gitlab/Issue/FE-301',
      'gid://gitlab/Issue/QA-401',
    ],
  },
  {
    id: 'gid://gitlab/Issue/PM-102',
    iid: '102',
    title: 'Main initiative B',
    webUrl: 'https://gitlab.example.com/group/project-pm/-/issues/102',
    projectId: 'gid://gitlab/Project/1',
    projectName: 'project-pm',
    projectPath: 'group/project-pm',
    totalTimeSpentSeconds: 0,
    timelogs: [],
    linkedIssueIds: ['gid://gitlab/Issue/BE-201'],
  },
  {
    id: 'gid://gitlab/Issue/BE-201',
    iid: '201',
    title: 'Backend task A',
    webUrl: 'https://gitlab.example.com/group/project-backend/-/issues/201',
    projectId: 'gid://gitlab/Project/2',
    projectName: 'project-backend',
    projectPath: 'group/project-backend',
    totalTimeSpentSeconds: 20 * 3600,
    timelogs: [
      entry('t-be-1', 'gid://gitlab/Issue/BE-201', U1, 10, '2026-04-02T09:00:00+05:00', 'Implemented backend flow'),
      entry('t-be-2', 'gid://gitlab/Issue/BE-201', U1, 5, '2026-04-11T09:00:00+05:00'),
      entry('t-be-3', 'gid://gitlab/Issue/BE-201', U2, 5, '2026-04-03T14:00:00+05:00', 'Reviewed integration details'),
    ],
    linkedIssueIds: [],
  },
  {
    id: 'gid://gitlab/Issue/FE-301',
    iid: '301',
    title: 'Frontend task A',
    webUrl: 'https://gitlab.example.com/group/project-frontend/-/issues/301',
    projectId: 'gid://gitlab/Project/3',
    projectName: 'project-frontend',
    projectPath: 'group/project-frontend',
    totalTimeSpentSeconds: 4 * 3600,
    timelogs: [
      entry('t-fe-1', 'gid://gitlab/Issue/FE-301', U2, 4, '2026-04-20T11:00:00+05:00'),
    ],
    linkedIssueIds: [],
  },
  {
    id: 'gid://gitlab/Issue/QA-401',
    iid: '401',
    title: 'QA task A',
    webUrl: 'https://gitlab.example.com/group/project-qa/-/issues/401',
    projectId: 'gid://gitlab/Project/4',
    projectName: 'project-qa',
    projectPath: 'group/project-qa',
    totalTimeSpentSeconds: 3 * 3600,
    timelogs: [
      entry('t-qa-1', 'gid://gitlab/Issue/QA-401', U2, 1, '2026-04-01T00:00:00+05:00', 'Smoke testing'),
      entry('t-qa-2', 'gid://gitlab/Issue/QA-401', U2, 2, '2026-04-05T23:59:00+05:00'),
    ],
    linkedIssueIds: [],
  },
  {
    id: 'gid://gitlab/Issue/MISC-501',
    iid: '501',
    title: 'Standalone task',
    webUrl: 'https://gitlab.example.com/group/project-misc/-/issues/501',
    projectId: 'gid://gitlab/Project/5',
    projectName: 'project-misc',
    projectPath: 'group/project-misc',
    totalTimeSpentSeconds: 3 * 3600,
    timelogs: [
      entry('t-misc-1', 'gid://gitlab/Issue/MISC-501', U1, 3, '2026-04-04T12:00:00+05:00'),
    ],
    linkedIssueIds: [],
  },
  {
    id: 'gid://gitlab/Issue/MISC-502',
    iid: '502',
    title: 'Out-of-period standalone task',
    webUrl: 'https://gitlab.example.com/group/project-misc/-/issues/502',
    projectId: 'gid://gitlab/Project/5',
    projectName: 'project-misc',
    projectPath: 'group/project-misc',
    totalTimeSpentSeconds: 7 * 3600,
    timelogs: [
      entry('t-misc502-1', 'gid://gitlab/Issue/MISC-502', U1, 7, '2026-04-15T12:00:00+05:00'),
    ],
    linkedIssueIds: [],
  },
];
