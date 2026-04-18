import type { RawIssue, TimeEntry } from '../types';
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

const ISSUE_PAGE_SIZE = 100;
const TIMELOG_PAGE_SIZE = 100;
const ISSUE_LINKS_PAGE_SIZE = 100;
const LINK_FETCH_CONCURRENCY = 8;
const PERIOD_ACTIVITY_FETCH_CONCURRENCY = 4;
const FULL_ISSUE_FETCH_CONCURRENCY = 8;

const projectIssueCatalogCache = new Map<string, Promise<IssueStub[]>>();
const issueLinksCache = new Map<string, Promise<LinkedIssueRef[]>>();

function issueRefKey(projectPath: string, iid: string) {
  return `${projectPath}#${iid}`;
}

function projectCacheKey(instanceOrigin: string, projectPath: string) {
  return `${instanceOrigin}|${projectPath}`;
}

function issueLinkCacheKey(instanceOrigin: string, projectPath: string, iid: string) {
  return `${instanceOrigin}|${projectPath}#${iid}`;
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

  private async restPage<T>(path: string): Promise<{ data: T; nextPage: string | null }> {
    const res = await fetch(`${this.instanceOrigin}/api/v4${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`GitLab REST ${res.status}: ${res.statusText} for ${path}`);
    }
    return {
      data: (await res.json()) as T,
      nextPage: res.headers.get('x-next-page'),
    };
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
    allowedRefs: Set<string> | undefined,
    logger?: BuildLogger
  ): Promise<Map<string, RawIssue>> {
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
    let filteredOutTimelogs = 0;

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
        if (allowedRefs && !allowedRefs.has(key)) {
          filteredOutTimelogs += 1;
          continue;
        }

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

    if (filteredOutTimelogs > 0) {
      logger?.info(
        `Timelogs ${projectPath}: filtered out ${filteredOutTimelogs} entry(s) outside the linked issue set`
      );
    }
    if (skippedNonIssueTimelogs > 0) {
      logger?.info(
        `Timelogs ${projectPath}: skipped ${skippedNonIssueTimelogs} non-issue timelog entr${skippedNonIssueTimelogs === 1 ? 'y' : 'ies'}`
      );
    }

    return issuesByRef;
  }

  async fetchIssueByPathAndIid(projectPath: string, iid: string): Promise<RawIssue | null> {
    const query = `
      query IssueByIid($fullPath: ID!, $iid: String!) {
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
            timelogs(first: 200) {
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
          timelogs: { nodes: TimelogNode[] };
        } | null;
      } | null;
    };
    const data = await this.graphql<Resp>(query, { fullPath: projectPath, iid });
    if (!data.project?.issue) return null;
    const issue = data.project.issue;
    return {
      id: issue.id,
      iid: issue.iid,
      title: issue.title,
      webUrl: issue.webUrl,
      projectId: data.project.id,
      projectName: data.project.name,
      projectPath: data.project.fullPath,
      totalTimeSpentSeconds: issue.totalTimeSpent || 0,
      timelogs: issue.timelogs.nodes.map((t) => this.toTimeEntry(issue.id, t)),
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
}

export async function loadReportData(
  client: GitLabClient,
  projectPath: string,
  startDate: string,
  endDate: string,
  logger?: BuildLogger
): Promise<RawIssue[]> {
  logger?.phase(`Starting data collection from project ${projectPath}`, {
    strategy: 'activity-first',
    startDate,
    endDate,
  });

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

  const linkedRefsByProject = new Map<string, Set<string>>();
  for (const [key, ref] of uniqueLinkedRefs) {
    if (!linkedRefsByProject.has(ref.projectPath)) linkedRefsByProject.set(ref.projectPath, new Set());
    linkedRefsByProject.get(ref.projectPath)!.add(key);
  }

  logger?.success(
    `Link graph ready: ${totalLinksFound} link(s), ${uniqueLinkedRefs.size} unique linked issue(s), ${linkedRefsByProject.size} linked project(s)`
  );

  logger?.phase('Collecting period activity by project', {
    projects: 1 + linkedRefsByProject.size,
    concurrency: PERIOD_ACTIVITY_FETCH_CONCURRENCY,
  });

  const projectPathsForActivity = [projectPath, ...Array.from(linkedRefsByProject.keys())];
  const periodIssuesByRef = new Map<string, RawIssue>();
  let completedActivityProjects = 0;

  await mapWithConcurrency(
    projectPathsForActivity,
    PERIOD_ACTIVITY_FETCH_CONCURRENCY,
    async (activityProjectPath) => {
      const allowedRefs =
        activityProjectPath === projectPath ? undefined : linkedRefsByProject.get(activityProjectPath);

      logger?.info(
        `GraphQL: collecting period timelogs for ${activityProjectPath}${
          allowedRefs ? ` (${allowedRefs.size} linked candidate(s))` : ''
        }`
      );

      const issues = await client.fetchProjectPeriodIssues(
        activityProjectPath,
        startDate,
        endDate,
        allowedRefs,
        logger
      );

      for (const [key, issue] of issues) {
        periodIssuesByRef.set(key, issue);
      }

      completedActivityProjects += 1;
      logger?.success(
        `Activity ${completedActivityProjects}/${projectPathsForActivity.length}: ${activityProjectPath} -> ${issues.size} active issue(s)`
      );

      return issues;
    }
  );

  const activeIssueRefKeys = new Set(periodIssuesByRef.keys());
  logger?.success(
    `Period activity ready: ${activeIssueRefKeys.size} issue(s) with time in ${startDate}..${endDate}`
  );

  if (activeIssueRefKeys.size === 0) {
    logger?.phase('No period activity found in PM project or linked issue set');
    logger?.phase('Data collection complete');
    return [];
  }

  logger?.phase('Selecting active PM roots and expanding context');

  const activeRootRefs = new Map<string, IssueStub>();
  const neededRefs = new Map<string, LinkedIssueRef>();

  for (const pm of pmIssueStubs) {
    const rootKey = issueRefKey(pm.projectPath, pm.iid);
    const linkedRefs = linksByPmIssueId.get(pm.id) || [];
    const hasOwnActivity = activeIssueRefKeys.has(rootKey);
    const hasLinkedActivity = linkedRefs.some((ref) =>
      activeIssueRefKeys.has(issueRefKey(ref.projectPath, ref.iid))
    );

    if (!hasOwnActivity && !hasLinkedActivity) continue;

    activeRootRefs.set(rootKey, pm);
    neededRefs.set(rootKey, { projectPath: pm.projectPath, iid: pm.iid });
    for (const link of linkedRefs) {
      neededRefs.set(issueRefKey(link.projectPath, link.iid), link);
    }
  }

  logger?.success(
    `Expanded active context to ${activeRootRefs.size} PM root(s) and ${neededRefs.size} issue(s)`
  );

  logger?.phase('Loading full issue details for active context', {
    issues: neededRefs.size,
    concurrency: FULL_ISSUE_FETCH_CONCURRENCY,
  });

  const fullIssuesByRef = new Map<string, RawIssue>();
  let completedDetailFetches = 0;
  let inaccessibleDetailIssues = 0;

  await mapWithConcurrency(
    Array.from(neededRefs.values()),
    FULL_ISSUE_FETCH_CONCURRENCY,
    async (ref) => {
      logger?.info(`GraphQL: loading full issue ${ref.projectPath}#${ref.iid}`);
      const issue = await client.fetchIssueByPathAndIid(ref.projectPath, ref.iid);
      completedDetailFetches += 1;

      if (!issue) {
        inaccessibleDetailIssues += 1;
        logger?.warn(
          `Details ${completedDetailFetches}/${neededRefs.size}: ${ref.projectPath}#${ref.iid} not accessible`
        );
        return null;
      }

      fullIssuesByRef.set(issueRefKey(ref.projectPath, ref.iid), issue);
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
      logger?.warn(`Falling back to period-only data for ${ref.projectPath}#${ref.iid}`);
      continue;
    }

    const pmStub = pmIssueStubsByRef.get(key);
    if (pmStub) {
      fullIssuesByRef.set(key, stubToRawIssue(pmStub));
      logger?.warn(`Falling back to catalog-only data for ${ref.projectPath}#${ref.iid}`);
    }
  }

  const finalIssuesById = new Map<string, RawIssue>();
  for (const [rootKey, pm] of activeRootRefs) {
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

  logger?.success(
    `Data collection complete: ${finalIssuesById.size} issue(s) ready for aggregation, ${inaccessibleDetailIssues} inaccessible during detail load`
  );

  return Array.from(finalIssuesById.values());
}
