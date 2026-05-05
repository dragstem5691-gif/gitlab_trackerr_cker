import type { GitLabGroupScope, GitLabProjectScope, RawIssue, TimeEntry } from '../types';
import type { BuildLogger } from './logger';

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

type TimelogUserNode = {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string | null;
};

type TimelogNode = {
  id: string;
  timeSpent: number;
  spentAt: string;
  user?: TimelogUserNode | null;
};

export interface GitLabGanttMilestone {
  id: string;
  iid: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  state: string;
}

export interface GitLabGanttIssue extends RawIssue {
  sourceScopePath: string;
}

export type GitLabGanttIssueStrategy = 'milestone' | 'active';

export interface GitLabGanttIssueFetchParams {
  strategy?: GitLabGanttIssueStrategy;
  milestoneTitle?: string | null;
  updatedAfter?: string | null;
}

interface RestMilestone {
  id: number;
  iid: number;
  title: string;
  start_date: string | null;
  due_date: string | null;
  state: string;
}

interface RestProject {
  id: number;
  name: string;
  path_with_namespace: string;
}

interface RestGroup {
  id: number;
  name: string;
  full_path: string;
  web_url?: string;
}

interface RestIssue {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  project_id: number;
  state: string;
  closed_at: string | null;
  due_date: string | null;
  updated_at: string;
  labels: string[];
  assignees: {
    id: number;
    name: string;
    username: string;
    avatar_url?: string | null;
  }[];
  milestone: RestMilestone | null;
  time_stats?: {
    time_estimate?: number;
    total_time_spent?: number;
  };
}

interface IssueStub {
  id: string;
  iid: string;
  title: string;
  webUrl: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  totalTimeSpentSeconds: number;
}

interface LinkedIssueRef {
  projectPath: string;
  iid: string;
}

interface PmComponent {
  pmIssues: IssueStub[];
  linkedRefs: LinkedIssueRef[];
}

interface ProjectPeriodIssuesResult {
  issues: Map<string, RawIssue>;
  skippedNonIssueTimelogs: number;
}

const ISSUE_PAGE_SIZE = 100;
const TIMELOG_PAGE_SIZE = 100;
const ISSUE_LINKS_PAGE_SIZE = 100;
const LINK_FETCH_CONCURRENCY = 8;
const PERIOD_ACTIVITY_FETCH_CONCURRENCY = 4;
const FULL_ISSUE_FETCH_CONCURRENCY = 8;

const projectIssueCatalogCache = new Map<string, Promise<IssueStub[]>>();
const issueLinksCache = new Map<string, Promise<LinkedIssueRef[]>>();

export interface LoadReportDataResult {
  issues: RawIssue[];
  warnings: string[];
}

function issueRefKey(projectPath: string, iid: string) {
  return `${projectPath}#${iid}`;
}

function projectCacheKey(instanceOrigin: string, projectPath: string) {
  return `${instanceOrigin}|${projectPath}`;
}

function issueLinkCacheKey(instanceOrigin: string, projectPath: string, iid: string) {
  return `${instanceOrigin}|${projectPath}#${iid}`;
}

function buildPmComponents(
  pmIssueStubs: IssueStub[],
  linksByPmIssueId: Map<string, LinkedIssueRef[]>
): PmComponent[] {
  const orderByIssueId = new Map<string, number>();
  const pmIssueById = new Map<string, IssueStub>();
  const pmIssueByRef = new Map<string, IssueStub>();
  const adjacency = new Map<string, Set<string>>();

  pmIssueStubs.forEach((issue, index) => {
    orderByIssueId.set(issue.id, index);
    pmIssueById.set(issue.id, issue);
    pmIssueByRef.set(issueRefKey(issue.projectPath, issue.iid), issue);
    adjacency.set(issue.id, new Set());
  });

  for (const issue of pmIssueStubs) {
    for (const link of linksByPmIssueId.get(issue.id) || []) {
      const linkedPmIssue = pmIssueByRef.get(issueRefKey(link.projectPath, link.iid));
      if (!linkedPmIssue) continue;
      adjacency.get(issue.id)?.add(linkedPmIssue.id);
      adjacency.get(linkedPmIssue.id)?.add(issue.id);
    }
  }

  const visited = new Set<string>();
  const components: PmComponent[] = [];

  for (const issue of pmIssueStubs) {
    if (visited.has(issue.id)) continue;

    const stack = [issue.id];
    const componentIssueIds: string[] = [];
    visited.add(issue.id);

    while (stack.length > 0) {
      const currentIssueId = stack.pop()!;
      componentIssueIds.push(currentIssueId);

      for (const linkedIssueId of adjacency.get(currentIssueId) || []) {
        if (visited.has(linkedIssueId)) continue;
        visited.add(linkedIssueId);
        stack.push(linkedIssueId);
      }
    }

    componentIssueIds.sort(
      (left, right) =>
        (orderByIssueId.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (orderByIssueId.get(right) ?? Number.MAX_SAFE_INTEGER)
    );

    const componentPmIssues = componentIssueIds
      .map((issueId) => pmIssueById.get(issueId))
      .filter((issue): issue is IssueStub => Boolean(issue));

    const linkedRefs = new Map<string, LinkedIssueRef>();
    for (const componentPmIssue of componentPmIssues) {
      for (const link of linksByPmIssueId.get(componentPmIssue.id) || []) {
        linkedRefs.set(issueRefKey(link.projectPath, link.iid), link);
      }
    }

    components.push({
      pmIssues: componentPmIssues,
      linkedRefs: Array.from(linkedRefs.values()),
    });
  }

  return components;
}

function stubToRawIssue(stub: IssueStub, timelogs: TimeEntry[] = []): RawIssue {
  return {
    id: stub.id,
    iid: stub.iid,
    title: stub.title,
    webUrl: stub.webUrl,
    projectId: stub.projectId,
    projectName: stub.projectName,
    projectPath: stub.projectPath,
    totalTimeSpentSeconds: stub.totalTimeSpentSeconds,
    timelogs,
    linkedIssueIds: [],
  };
}

function mergeIssueData(primary: RawIssue, secondary: RawIssue): RawIssue {
  const timelogById = new Map<string, TimeEntry>();

  for (const timelog of primary.timelogs) {
    timelogById.set(timelog.id, timelog);
  }
  for (const timelog of secondary.timelogs) {
    timelogById.set(timelog.id, timelog);
  }

  const linkedIssueIds = new Set<string>(primary.linkedIssueIds);
  for (const linkedIssueId of secondary.linkedIssueIds) {
    linkedIssueIds.add(linkedIssueId);
  }

  return {
    ...primary,
    totalTimeSpentSeconds: primary.totalTimeSpentSeconds || secondary.totalTimeSpentSeconds,
    timelogs: Array.from(timelogById.values()),
    linkedIssueIds: Array.from(linkedIssueIds),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) break;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

export class GitLabClient {
  constructor(private instanceOrigin: string, private token: string) {}

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.instanceOrigin}/api/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`GitLab GraphQL ${res.status}: ${res.statusText}`);
    }
    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join('; '));
    }
    if (!body.data) throw new Error('Empty GraphQL response');
    return body.data;
  }

  async updateIssueDates(
    projectPath: string,
    iid: string,
    updates: { startDate?: string | null; dueDate?: string | null }
  ): Promise<void> {
    const body: Record<string, string> = {};
    if (updates.dueDate !== undefined) body.due_date = updates.dueDate ?? '';
    if (updates.startDate !== undefined) body.start_date = updates.startDate ?? '';
    if (Object.keys(body).length === 0) return;

    const res = await fetch(
      `${this.instanceOrigin}/api/v4/projects/${encodeURIComponent(projectPath)}/issues/${iid}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `GitLab PUT ${res.status}: ${res.statusText} for ${projectPath}#${iid}${text ? ` — ${text}` : ''}`
      );
    }

    if (updates.startDate !== undefined) {
      await this.updateIssueStartDateViaGraphQL(projectPath, iid, updates.startDate);
    }
  }

  private async updateIssueStartDateViaGraphQL(
    projectPath: string,
    iid: string,
    startDate: string | null
  ): Promise<void> {
    const lookup = `
      query IssueWorkItemId($fullPath: ID!, $iid: String!) {
        project(fullPath: $fullPath) {
          issue(iid: $iid) { id }
        }
      }
    `;
    type LookupResp = { project: { issue: { id: string } | null } | null };

    let data: LookupResp;
    try {
      data = await this.graphql<LookupResp>(lookup, { fullPath: projectPath, iid });
    } catch {
      return;
    }
    const workItemId = data.project?.issue?.id;
    if (!workItemId) return;

    const mutation = `
      mutation SetStart($input: WorkItemUpdateInput!) {
        workItemUpdate(input: $input) {
          errors
        }
      }
    `;
    type MutationResp = { workItemUpdate: { errors: string[] } };
    const input = {
      id: workItemId,
      startAndDueDateWidget: { startDate: startDate ?? null },
    };
    try {
      await this.graphql<MutationResp>(mutation, { input });
    } catch {
      // Ignore — some GitLab versions/editions don't expose this widget.
    }
  }

  private async restPage<T>(path: string): Promise<{ data: T; nextPage: string | null }> {
    const res = await fetch(`${this.instanceOrigin}/api/v4${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const error = new Error(`GitLab REST ${res.status}: ${res.statusText} for ${path}`);
      (error as Error & { status?: number }).status = res.status;
      throw error;
    }
    return {
      data: (await res.json()) as T,
      nextPage: res.headers.get('x-next-page'),
    };
  }

  async fetchGanttMilestones(scopePath: string, logger?: BuildLogger): Promise<GitLabGanttMilestone[]> {
    logger?.phase(`Loading GitLab milestones from ${scopePath}`);
    const projectMilestones = await this.tryFetchAllRestPages<RestMilestone>(
      `/projects/${encodeURIComponent(scopePath)}/milestones?state=all&per_page=100`,
      logger
    );
    if (projectMilestones) return projectMilestones.map(toGanttMilestone);

    const groupMilestones = await this.tryFetchAllRestPages<RestMilestone>(
      `/groups/${encodeURIComponent(scopePath)}/milestones?state=all&per_page=100`,
      logger
    );
    if (groupMilestones) return groupMilestones.map(toGanttMilestone);

    logger?.warn(`Milestones are not available for ${scopePath}`);
    return [];
  }

  async fetchDescendantGroups(
    groupPath: string,
    logger?: BuildLogger
  ): Promise<GitLabGroupScope[]> {
    logger?.phase(`Checking GitLab subgroups in ${groupPath}`);

    const [descendants, directSubgroups] = await Promise.all([
      this.tryFetchAllRestPages<RestGroup>(
        `/groups/${encodeURIComponent(groupPath)}/descendant_groups?per_page=100`,
        logger
      ),
      this.tryFetchAllRestPages<RestGroup>(
        `/groups/${encodeURIComponent(groupPath)}/subgroups?per_page=100`,
        logger
      ),
    ]);

    if (!descendants && !directSubgroups) {
      logger?.info(`${groupPath} is not accessible as a GitLab group, skipping subgroup lookup`);
      return [];
    }

    const groupsByPath = new Map<string, RestGroup>();
    for (const group of [...(descendants ?? []), ...(directSubgroups ?? [])]) {
      groupsByPath.set(group.full_path, group);
    }

    const subgroups = Array.from(groupsByPath.values())
      .map(toGroupScope)
      .sort((left, right) => left.fullPath.localeCompare(right.fullPath));

    if (subgroups.length > 0) {
      logger?.success(`Found ${subgroups.length} subgroup(s) under ${groupPath}`);
    } else {
      logger?.info(`No subgroups found under ${groupPath}`);
    }

    return subgroups;
  }

  async fetchGroupProjects(
    groupPath: string,
    logger?: BuildLogger
  ): Promise<GitLabProjectScope[]> {
    logger?.phase(`Checking GitLab projects in ${groupPath}`);

    const projects = await this.tryFetchAllRestPages<RestProject>(
      `/groups/${encodeURIComponent(groupPath)}/projects?include_subgroups=true&simple=true&per_page=100`,
      logger
    );
    if (!projects) {
      logger?.info(`${groupPath} is not accessible as a GitLab group, skipping project discovery`);
      return [];
    }

    const projectScopes = projects
      .map(toProjectScope)
      .sort((left, right) => left.fullPath.localeCompare(right.fullPath));

    logger?.success(
      `Found ${projectScopes.length} project(s) under ${groupPath} including subgroups`
    );

    return projectScopes;
  }

  async fetchGanttIssuesFromScope(
    scopePath: string,
    params: GitLabGanttIssueFetchParams = {},
    logger?: BuildLogger
  ): Promise<GitLabGanttIssue[]> {
    if ((params.strategy ?? 'active') === 'milestone' && !params.milestoneTitle) {
      return [];
    }

    logger?.phase(`Loading GitLab issues from main scope ${scopePath}`, {
      strategy: params.strategy ?? 'active',
      milestone: params.milestoneTitle ?? 'any',
      updatedAfter: params.updatedAfter ?? 'none',
    });

    const projectIssues = await this.tryFetchProjectGanttIssues(
      scopePath,
      scopePath,
      params,
      logger
    );
    if (projectIssues) return projectIssues;

    const projects = await this.tryFetchAllRestPages<RestProject>(
      `/groups/${encodeURIComponent(scopePath)}/projects?include_subgroups=true&simple=true&per_page=100`,
      logger
    );
    if (!projects) {
      logger?.warn(`Main scope ${scopePath} is not accessible as a project or group`);
      return [];
    }

    const issueBatches = await mapWithConcurrency(projects, 4, async (project) => {
      const issues = await this.fetchProjectGanttIssuesByEncodedId(
        String(project.id),
        project.path_with_namespace,
        project.name,
        scopePath,
        params,
        logger
      );
      return issues;
    });

    return issueBatches.flat();
  }

  async fetchGanttIssuesFromProject(
    projectPath: string,
    params: GitLabGanttIssueFetchParams = {},
    logger?: BuildLogger
  ): Promise<GitLabGanttIssue[]> {
    if ((params.strategy ?? 'active') === 'milestone' && !params.milestoneTitle) {
      return [];
    }

    return (
      (await this.tryFetchProjectGanttIssues(
        projectPath,
        projectPath,
        params,
        logger
      )) ?? []
    );
  }

  async fetchProjectIssueStubs(projectPath: string, logger?: BuildLogger): Promise<IssueStub[]> {
    const cacheKey = projectCacheKey(this.instanceOrigin, projectPath);
    const cached = projectIssueCatalogCache.get(cacheKey);
    if (cached) {
      logger?.info(`GraphQL: reusing cached PM issue catalog for ${projectPath}`);
      return cached;
    }

    const promise = (async () => {
      const query = `
        query ProjectIssueCatalog($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            id
            name
            fullPath
            issues(first: ${ISSUE_PAGE_SIZE}, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                iid
                title
                webUrl
                totalTimeSpent
              }
            }
          }
        }
      `;
      type Resp = {
        project: {
          id: string;
          name: string;
          fullPath: string;
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              id: string;
              iid: string;
              title: string;
              webUrl: string;
              totalTimeSpent: number;
            }[];
          };
        } | null;
      };

      const issues: IssueStub[] = [];
      let cursor: string | null = null;
      let page = 0;

      while (true) {
        page += 1;
        logger?.info(
          `GraphQL: fetching PM issue catalog page ${page}${cursor ? ' (after cursor)' : ''}`
        );
        const data: Resp = await this.graphql<Resp>(query, {
          fullPath: projectPath,
          after: cursor,
        });
        if (!data.project) throw new Error(`Project not found: ${projectPath}`);

        for (const node of data.project.issues.nodes) {
          issues.push({
            id: node.id,
            iid: node.iid,
            title: node.title,
            webUrl: node.webUrl,
            projectId: data.project.id,
            projectName: data.project.name,
            projectPath: data.project.fullPath,
            totalTimeSpentSeconds: node.totalTimeSpent || 0,
          });
        }

        logger?.success(
          `Catalog page ${page}: received ${data.project.issues.nodes.length} issue(s), ${issues.length} total so far`
        );

        if (!data.project.issues.pageInfo.hasNextPage) break;
        cursor = data.project.issues.pageInfo.endCursor;
      }

      return issues;
    })();

    projectIssueCatalogCache.set(cacheKey, promise);
    try {
      return await promise;
    } catch (error) {
      projectIssueCatalogCache.delete(cacheKey);
      throw error;
    }
  }

  async fetchIssueLinkedIids(
    projectPath: string,
    iid: string,
    logger?: BuildLogger
  ): Promise<LinkedIssueRef[]> {
    const cacheKey = issueLinkCacheKey(this.instanceOrigin, projectPath, iid);
    const cached = issueLinksCache.get(cacheKey);
    if (cached) {
      logger?.info(`REST: reusing cached links for ${projectPath}#${iid}`);
      return cached;
    }

    const promise = (async () => {
      type LinkItem = {
        iid: number;
        references: { full: string };
      };

      const allLinks: LinkedIssueRef[] = [];
      let page = 1;

      while (true) {
        logger?.info(`REST: fetching links page ${page} for ${projectPath}#${iid}`);
        const { data, nextPage } = await this.restPage<LinkItem[]>(
          `/projects/${encodeURIComponent(projectPath)}/issues/${iid}/links?per_page=${ISSUE_LINKS_PAGE_SIZE}&page=${page}`
        );

        for (const item of data) {
          const parts = item.references.full.split('#');
          if (!parts[0] || !parts[1]) continue;
          allLinks.push({ projectPath: parts[0], iid: String(item.iid) });
        }

        if (!nextPage) break;
        page = Number(nextPage);
        if (!Number.isFinite(page) || page <= 0) break;
      }

      const deduped = new Map<string, LinkedIssueRef>();
      for (const link of allLinks) {
        deduped.set(issueRefKey(link.projectPath, link.iid), link);
      }
      return Array.from(deduped.values());
    })();

    issueLinksCache.set(cacheKey, promise);
    try {
      return await promise;
    } catch (error) {
      issueLinksCache.delete(cacheKey);
      throw error;
    }
  }

  async fetchProjectPeriodIssues(
    projectPath: string,
    startDate: string,
    endDate: string,
    logger?: BuildLogger
  ): Promise<ProjectPeriodIssuesResult> {
    const query = `
      query ProjectTimelogs($fullPath: ID!, $startDate: Time!, $endDate: Time!, $after: String) {
        project(fullPath: $fullPath) {
          id
          name
          fullPath
          timelogs(startDate: $startDate, endDate: $endDate, first: ${TIMELOG_PAGE_SIZE}, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              timeSpent
              spentAt
              user { id name username avatarUrl }
              issue {
                id
                iid
                title
                webUrl
              }
            }
          }
        }
      }
    `;

    type Resp = {
      project: {
        id: string;
        name: string;
        fullPath: string;
        timelogs: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: (TimelogNode & {
            issue: {
              id: string;
              iid: string;
              title: string;
              webUrl: string;
            } | null;
          })[];
        };
      } | null;
    };

    const issuesByRef = new Map<string, RawIssue>();
    let cursor: string | null = null;
    let page = 0;
    let skippedNonIssueTimelogs = 0;

    while (true) {
      page += 1;
      const data: Resp = await this.graphql<Resp>(query, {
        fullPath: projectPath,
        startDate,
        endDate,
        after: cursor,
      });
      if (!data.project) throw new Error(`Project not found: ${projectPath}`);

      let relevantTimelogs = 0;
      for (const node of data.project.timelogs.nodes) {
        if (!node.issue) {
          skippedNonIssueTimelogs += 1;
          continue;
        }

        const key = issueRefKey(data.project.fullPath, node.issue.iid);
        let issue = issuesByRef.get(key);
        if (!issue) {
          issue = stubToRawIssue({
            id: node.issue.id,
            iid: node.issue.iid,
            title: node.issue.title,
            webUrl: node.issue.webUrl,
            projectId: data.project.id,
            projectName: data.project.name,
            projectPath: data.project.fullPath,
            totalTimeSpentSeconds: 0,
          });
          issuesByRef.set(key, issue);
        }

        issue.timelogs.push(this.toTimeEntry(node.issue.id, node));
        relevantTimelogs += 1;
      }

      logger?.success(
        `Timelogs ${projectPath} page ${page}: ${data.project.timelogs.nodes.length} raw entry(s), ${relevantTimelogs} relevant, ${issuesByRef.size} active issue(s) so far`
      );

      if (!data.project.timelogs.pageInfo.hasNextPage) break;
      cursor = data.project.timelogs.pageInfo.endCursor;
    }

    if (skippedNonIssueTimelogs > 0) {
      logger?.info(
        `Timelogs ${projectPath}: skipped ${skippedNonIssueTimelogs} non-issue timelog entr${skippedNonIssueTimelogs === 1 ? 'y' : 'ies'}`
      );
    }

    return {
      issues: issuesByRef,
      skippedNonIssueTimelogs,
    };
  }

  async fetchIssueByPathAndIid(
    projectPath: string,
    iid: string,
    logger?: BuildLogger
  ): Promise<RawIssue | null> {
    const query = `
      query IssueByIid($fullPath: ID!, $iid: String!, $after: String) {
        project(fullPath: $fullPath) {
          id
          name
          fullPath
          issue(iid: $iid) {
            id
            iid
            title
            webUrl
            totalTimeSpent
            timelogs(first: ${TIMELOG_PAGE_SIZE}, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                timeSpent
                spentAt
                user { id name username avatarUrl }
              }
            }
          }
        }
      }
    `;
    type Resp = {
      project: {
        id: string;
        name: string;
        fullPath: string;
        issue: {
          id: string;
          iid: string;
          title: string;
          webUrl: string;
          totalTimeSpent: number;
          timelogs: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: TimelogNode[];
          };
        } | null;
      } | null;
    };

    let cursor: string | null = null;
    let page = 0;
    let issueMeta: Resp['project'] | null = null;
    let issue: NonNullable<NonNullable<Resp['project']>['issue']> | null = null;
    const timelogs: TimeEntry[] = [];

    while (true) {
      page += 1;
      if (page > 1) {
        logger?.info(`GraphQL: fetching timelog page ${page} for ${projectPath}#${iid}`);
      }

      const data: Resp = await this.graphql<Resp>(query, {
        fullPath: projectPath,
        iid,
        after: cursor,
      });
      const project = data.project;
      if (!project?.issue) return null;

      const currentIssue = project.issue;
      issueMeta = project;
      issue = currentIssue;
      timelogs.push(...currentIssue.timelogs.nodes.map((t) => this.toTimeEntry(currentIssue.id, t)));

      if (!currentIssue.timelogs.pageInfo.hasNextPage) break;
      cursor = currentIssue.timelogs.pageInfo.endCursor;
    }

    if (!issueMeta || !issue) return null;

    return {
      id: issue.id,
      iid: issue.iid,
      title: issue.title,
      webUrl: issue.webUrl,
      projectId: issueMeta.id,
      projectName: issueMeta.name,
      projectPath: issueMeta.fullPath,
      totalTimeSpentSeconds: issue.totalTimeSpent || 0,
      timelogs,
      linkedIssueIds: [],
    };
  }

  private toTimeEntry(issueId: string, t: TimelogNode): TimeEntry {
    return {
      id: t.id,
      issueId,
      userId: t.user?.id || `unknown-user:${t.id}`,
      userName: t.user?.name || 'Unknown user',
      userAvatarUrl: t.user?.avatarUrl || undefined,
      timeSpentSeconds: t.timeSpent,
      spentAt: t.spentAt,
    };
  }

  private async tryFetchProjectGanttIssues(
    projectPath: string,
    sourceScopePath: string,
    params: GitLabGanttIssueFetchParams,
    logger?: BuildLogger
  ): Promise<GitLabGanttIssue[] | null> {
    try {
      const projectData = await this.restPage<{ id: number; name: string; path_with_namespace: string }>(
        `/projects/${encodeURIComponent(projectPath)}`
      );
      return this.fetchProjectGanttIssuesByEncodedId(
        encodeURIComponent(projectPath),
        projectData.data.path_with_namespace,
        projectData.data.name,
        sourceScopePath,
        params,
        logger
      );
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 404 || status === 403) return null;
      throw error;
    }
  }

  private async fetchProjectGanttIssuesByEncodedId(
    encodedProjectId: string,
    projectPath: string,
    projectName: string,
    sourceScopePath: string,
    fetchParams: GitLabGanttIssueFetchParams,
    logger?: BuildLogger
  ): Promise<GitLabGanttIssue[]> {
    const strategy = fetchParams.strategy ?? 'active';
    const baseParams = new URLSearchParams({
      scope: 'all',
      per_page: '100',
      order_by: 'updated_at',
      sort: 'desc',
    });

    if (strategy === 'milestone') {
      if (!fetchParams.milestoneTitle) return [];
      baseParams.set('state', 'all');
      baseParams.set('milestone', fetchParams.milestoneTitle);

      const issues = await this.fetchAllRestPages<RestIssue>(
        `/projects/${encodedProjectId}/issues?${baseParams.toString()}`,
        logger
      );

      logger?.success(`${projectPath}: loaded ${issues.length} milestone issue(s) for Gantt`);
      return issues.map((issue) => toGanttIssue(issue, projectPath, projectName, sourceScopePath));
    }

    const openedParams = new URLSearchParams(baseParams);
    openedParams.set('state', 'opened');
    const closedParams = new URLSearchParams(baseParams);
    closedParams.set('state', 'closed');
    if (fetchParams.updatedAfter) {
      closedParams.set('updated_after', fetchParams.updatedAfter);
    }

    const [openedIssues, recentlyClosedIssues] = await Promise.all([
      this.fetchAllRestPages<RestIssue>(
        `/projects/${encodedProjectId}/issues?${openedParams.toString()}`,
        logger
      ),
      this.fetchAllRestPages<RestIssue>(
        `/projects/${encodedProjectId}/issues?${closedParams.toString()}`,
        logger
      ),
    ]);

    const issues = dedupeRestIssues([...openedIssues, ...recentlyClosedIssues]);
    logger?.success(
      `${projectPath}: loaded ${issues.length} active issue(s) for Gantt (${openedIssues.length} opened, ${recentlyClosedIssues.length} recently closed)`
    );
    return issues.map((issue) => toGanttIssue(issue, projectPath, projectName, sourceScopePath));
  }

  private async tryFetchAllRestPages<T>(
    firstPath: string,
    logger?: BuildLogger
  ): Promise<T[] | null> {
    try {
      return await this.fetchAllRestPages<T>(firstPath, logger);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 404 || status === 403) return null;
      throw error;
    }
  }

  private async fetchAllRestPages<T>(firstPath: string, logger?: BuildLogger): Promise<T[]> {
    const items: T[] = [];
    let path = firstPath;
    let page = 1;

    while (true) {
      const separator = path.includes('?') ? '&' : '?';
      const pagePath = `${path}${separator}page=${page}`;
      logger?.info(`REST: fetching ${pagePath}`);
      const { data, nextPage } = await this.restPage<T[]>(pagePath);
      items.push(...data);
      if (!nextPage) break;
      page = Number(nextPage);
      if (!Number.isFinite(page) || page <= 0) break;
      path = firstPath;
    }

    return items;
  }
}

function toGanttMilestone(milestone: RestMilestone): GitLabGanttMilestone {
  return {
    id: String(milestone.id),
    iid: String(milestone.iid),
    title: milestone.title,
    startDate: milestone.start_date,
    dueDate: milestone.due_date,
    state: milestone.state,
  };
}

function toGroupScope(group: RestGroup): GitLabGroupScope {
  return {
    id: String(group.id),
    name: group.name,
    fullPath: group.full_path,
    webUrl: group.web_url,
  };
}

function toProjectScope(project: RestProject): GitLabProjectScope {
  return {
    id: String(project.id),
    name: project.name,
    fullPath: project.path_with_namespace,
  };
}

function dedupeRestIssues(issues: RestIssue[]) {
  const byProjectIssue = new Map<string, RestIssue>();
  for (const issue of issues) {
    byProjectIssue.set(`${issue.project_id}#${issue.iid}`, issue);
  }
  return Array.from(byProjectIssue.values());
}

function toGanttIssue(
  issue: RestIssue,
  projectPath: string,
  projectName: string,
  sourceScopePath: string
): GitLabGanttIssue {
  return {
    id: String(issue.id),
    iid: String(issue.iid),
    title: issue.title,
    webUrl: issue.web_url,
    projectId: String(issue.project_id),
    projectName,
    projectPath,
    totalTimeSpentSeconds: issue.time_stats?.total_time_spent ?? 0,
    timeEstimateSeconds: issue.time_stats?.time_estimate ?? 0,
    timelogs: [],
    linkedIssueIds: [],
    state: issue.state,
    closedAt: issue.closed_at,
    dueDate: issue.due_date,
    updatedAt: issue.updated_at,
    labels: issue.labels,
    milestone: issue.milestone ? toGanttMilestone(issue.milestone) : null,
    assignees: issue.assignees.map((assignee) => ({
      id: String(assignee.id),
      name: assignee.name,
      username: assignee.username,
      avatarUrl: assignee.avatar_url ?? undefined,
    })),
    sourceScopePath,
  };
}

export async function loadReportData(
  client: GitLabClient,
  projectPath: string,
  startDate: string,
  endDate: string,
  logger?: BuildLogger,
  activityProjectPaths: string[] = []
): Promise<LoadReportDataResult> {
  logger?.phase(`Starting data collection from project ${projectPath}`, {
    strategy: 'activity-first',
    startDate,
    endDate,
  });
  const warnings: string[] = [];

  const pmIssueStubs = await client.fetchProjectIssueStubs(projectPath, logger);
  logger?.success(`Loaded ${pmIssueStubs.length} PM issue stub(s) from the catalog`);

  const pmIssueStubsByRef = new Map<string, IssueStub>();
  for (const issue of pmIssueStubs) {
    pmIssueStubsByRef.set(issueRefKey(issue.projectPath, issue.iid), issue);
  }

  logger?.phase('Resolving PM issue links', {
    pmIssues: pmIssueStubs.length,
    concurrency: LINK_FETCH_CONCURRENCY,
  });

  const linksByPmIssueId = new Map<string, LinkedIssueRef[]>();
  const uniqueLinkedRefs = new Map<string, LinkedIssueRef>();
  let completedLinkFetches = 0;
  let totalLinksFound = 0;

  await mapWithConcurrency(pmIssueStubs, LINK_FETCH_CONCURRENCY, async (pm) => {
    const links = await client.fetchIssueLinkedIids(projectPath, pm.iid, logger);
    linksByPmIssueId.set(pm.id, links);

    totalLinksFound += links.length;
    completedLinkFetches += 1;
    for (const link of links) {
      uniqueLinkedRefs.set(issueRefKey(link.projectPath, link.iid), link);
    }

    logger?.success(
      `Links ${completedLinkFetches}/${pmIssueStubs.length}: #${pm.iid} -> ${links.length} linked item(s)`
    );
    return links;
  });

  const pmComponents = buildPmComponents(pmIssueStubs, linksByPmIssueId);
  logger?.success(
    `Resolved ${pmComponents.length} PM cluster(s) from ${pmIssueStubs.length} PM issue(s)`
  );

  const linkedRefsByProject = new Map<string, Set<string>>();
  for (const [key, ref] of uniqueLinkedRefs) {
    if (!linkedRefsByProject.has(ref.projectPath)) {
      linkedRefsByProject.set(ref.projectPath, new Set());
    }
    linkedRefsByProject.get(ref.projectPath)!.add(key);
  }

  const projectPathsForActivity = Array.from(
    new Set([projectPath, ...Array.from(linkedRefsByProject.keys()), ...activityProjectPaths])
  );

  logger?.success(
    `Link graph ready: ${totalLinksFound} link(s), ${uniqueLinkedRefs.size} unique linked issue(s), ${projectPathsForActivity.length} project(s) in scope`
  );

  logger?.phase('Collecting period activity by project', {
    projects: projectPathsForActivity.length,
    concurrency: PERIOD_ACTIVITY_FETCH_CONCURRENCY,
  });

  const periodIssuesByRef = new Map<string, RawIssue>();
  let completedActivityProjects = 0;
  let skippedNonIssueTimelogs = 0;

  await mapWithConcurrency(
    projectPathsForActivity,
    PERIOD_ACTIVITY_FETCH_CONCURRENCY,
    async (activityProjectPath) => {
      logger?.info(`GraphQL: collecting period timelogs for ${activityProjectPath}`);

      const result = await client.fetchProjectPeriodIssues(
        activityProjectPath,
        startDate,
        endDate,
        logger
      );

      for (const [key, issue] of result.issues) {
        periodIssuesByRef.set(key, issue);
      }
      skippedNonIssueTimelogs += result.skippedNonIssueTimelogs;

      completedActivityProjects += 1;
      logger?.success(
        `Activity ${completedActivityProjects}/${projectPathsForActivity.length}: ${activityProjectPath} -> ${result.issues.size} active issue(s)`
      );

      return result;
    }
  );

  const activeIssueRefKeys = new Set(periodIssuesByRef.keys());
  logger?.success(
    `Period activity ready: ${activeIssueRefKeys.size} issue(s) with time in ${startDate}..${endDate}`
  );

  if (activeIssueRefKeys.size === 0) {
    logger?.phase('No period activity found in PM project or linked issue set');
    logger?.phase('Data collection complete');
    return { issues: [], warnings };
  }

  logger?.phase('Selecting active PM clusters and expanding context');

  const activeComponents: PmComponent[] = [];
  const neededRefs = new Map<string, LinkedIssueRef>();

  for (const issue of periodIssuesByRef.values()) {
    neededRefs.set(issueRefKey(issue.projectPath, issue.iid), {
      projectPath: issue.projectPath,
      iid: issue.iid,
    });
  }

  for (const component of pmComponents) {
    const hasPmActivity = component.pmIssues.some((pm) =>
      activeIssueRefKeys.has(issueRefKey(pm.projectPath, pm.iid))
    );
    const hasLinkedActivity = component.linkedRefs.some((ref) =>
      activeIssueRefKeys.has(issueRefKey(ref.projectPath, ref.iid))
    );

    if (!hasPmActivity && !hasLinkedActivity) continue;

    activeComponents.push(component);
    for (const pm of component.pmIssues) {
      neededRefs.set(issueRefKey(pm.projectPath, pm.iid), {
        projectPath: pm.projectPath,
        iid: pm.iid,
      });
    }
    for (const link of component.linkedRefs) {
      neededRefs.set(issueRefKey(link.projectPath, link.iid), link);
    }
  }

  logger?.success(
    `Expanded active context to ${activeComponents.length} PM cluster(s) and ${neededRefs.size} issue(s)`
  );

  logger?.phase('Loading full issue details for active context', {
    issues: neededRefs.size,
    concurrency: FULL_ISSUE_FETCH_CONCURRENCY,
  });

  const fullIssuesByRef = new Map<string, RawIssue>();
  let completedDetailFetches = 0;
  let inaccessibleDetailIssues = 0;
  let periodFallbackIssues = 0;
  let catalogFallbackIssues = 0;

  await mapWithConcurrency(
    Array.from(neededRefs.values()),
    FULL_ISSUE_FETCH_CONCURRENCY,
    async (ref) => {
      logger?.info(`GraphQL: loading full issue ${ref.projectPath}#${ref.iid}`);
      const issue = await client.fetchIssueByPathAndIid(ref.projectPath, ref.iid, logger);
      completedDetailFetches += 1;

      if (!issue) {
        inaccessibleDetailIssues += 1;
        logger?.warn(
          `Details ${completedDetailFetches}/${neededRefs.size}: ${ref.projectPath}#${ref.iid} not accessible`
        );
        return null;
      }

      const key = issueRefKey(ref.projectPath, ref.iid);
      const periodIssue = periodIssuesByRef.get(key);
      fullIssuesByRef.set(key, periodIssue ? mergeIssueData(issue, periodIssue) : issue);
      logger?.success(
        `Details ${completedDetailFetches}/${neededRefs.size}: "${issue.title}" with ${issue.timelogs.length} all-time timelog(s)`
      );
      return issue;
    }
  );

  for (const [key, ref] of neededRefs) {
    if (fullIssuesByRef.has(key)) continue;

    const periodIssue = periodIssuesByRef.get(key);
    if (periodIssue) {
      fullIssuesByRef.set(key, {
        ...periodIssue,
        linkedIssueIds: [],
      });
      periodFallbackIssues += 1;
      logger?.warn(`Falling back to period-only data for ${ref.projectPath}#${ref.iid}`);
      continue;
    }

    const pmStub = pmIssueStubsByRef.get(key);
    if (pmStub) {
      fullIssuesByRef.set(key, stubToRawIssue(pmStub));
      catalogFallbackIssues += 1;
      logger?.warn(`Falling back to catalog-only data for ${ref.projectPath}#${ref.iid}`);
    }
  }

  const finalIssuesById = new Map<string, RawIssue>();
  for (const component of activeComponents) {
    for (const pm of component.pmIssues) {
      const rootKey = issueRefKey(pm.projectPath, pm.iid);
      const root =
        fullIssuesByRef.get(rootKey) ||
        periodIssuesByRef.get(rootKey) ||
        stubToRawIssue(pm);

      root.linkedIssueIds = [];
      for (const link of linksByPmIssueId.get(pm.id) || []) {
        const child = fullIssuesByRef.get(issueRefKey(link.projectPath, link.iid));
        if (!child) continue;
        root.linkedIssueIds.push(child.id);
        finalIssuesById.set(child.id, child);
      }

      finalIssuesById.set(root.id, root);
    }
  }

  for (const [key, periodIssue] of periodIssuesByRef) {
    const issue = fullIssuesByRef.get(key) || periodIssue;
    finalIssuesById.set(issue.id, issue);
  }

  logger?.success(
    `Data collection complete: ${finalIssuesById.size} issue(s) ready for aggregation, ${inaccessibleDetailIssues} inaccessible during detail load`
  );

  if (periodFallbackIssues > 0) {
    warnings.push(
      `${periodFallbackIssues} issue(s) used period-only timelog data because full issue details were unavailable. Period hours are preserved, but some all-time breakdowns may be incomplete.`
    );
  }
  if (catalogFallbackIssues > 0) {
    warnings.push(
      `${catalogFallbackIssues} PM issue(s) were loaded from the catalog only to preserve tree structure.`
    );
  }
  if (inaccessibleDetailIssues > 0) {
    warnings.push(
      `${inaccessibleDetailIssues} issue(s) could not be opened in detail with the current token. Full verification depends on access to every linked issue.`
    );
  }
  if (skippedNonIssueTimelogs > 0) {
    warnings.push(
      `${skippedNonIssueTimelogs} timelog entr${skippedNonIssueTimelogs === 1 ? 'y was' : 'ies were'} attached to non-issue items and skipped by the current report model. To guarantee full completeness, extend collection to GitLab Work Items and merge-request timelogs too.`
    );
  }

  return {
    issues: Array.from(finalIssuesById.values()),
    warnings,
  };
}

export async function loadReportDataForPmProjects(
  client: GitLabClient,
  pmProjectPaths: string[],
  startDate: string,
  endDate: string,
  logger?: BuildLogger,
  activityProjectPaths: string[] = []
): Promise<LoadReportDataResult> {
  const uniqueProjectPaths = Array.from(
    new Set(pmProjectPaths.map((projectPath) => projectPath.trim()).filter(Boolean))
  );
  const uniqueActivityProjectPaths = Array.from(
    new Set(activityProjectPaths.map((projectPath) => projectPath.trim()).filter(Boolean))
  );

  if (uniqueProjectPaths.length === 0) {
    return { issues: [], warnings: ['No PM project paths were provided.'] };
  }
  if (uniqueProjectPaths.length === 1) {
    return loadReportData(
      client,
      uniqueProjectPaths[0],
      startDate,
      endDate,
      logger,
      uniqueActivityProjectPaths
    );
  }

  logger?.phase('Starting data collection from multiple PM boards', {
    boards: uniqueProjectPaths.length,
  });

  const issuesById = new Map<string, RawIssue>();
  const warnings = new Set<string>();

  for (const [index, projectPath] of uniqueProjectPaths.entries()) {
    logger?.phase(`Collecting PM board ${index + 1}/${uniqueProjectPaths.length}: ${projectPath}`);
    const result = await loadReportData(
      client,
      projectPath,
      startDate,
      endDate,
      logger,
      index === 0 ? uniqueActivityProjectPaths : []
    );

    for (const issue of result.issues) {
      const existing = issuesById.get(issue.id);
      issuesById.set(issue.id, existing ? mergeIssueData(existing, issue) : issue);
    }
    for (const warning of result.warnings) {
      warnings.add(`${projectPath}: ${warning}`);
    }

    logger?.success(
      `PM board ${index + 1}/${uniqueProjectPaths.length}: merged ${result.issues.length} issue(s)`
    );
  }

  logger?.success(
    `Multi-board data collection complete: ${issuesById.size} unique issue(s) from ${uniqueProjectPaths.length} PM board(s)`
  );

  return {
    issues: Array.from(issuesById.values()),
    warnings: Array.from(warnings),
  };
}
