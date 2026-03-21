import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';

// Queue of responses to return from execFile mock, simulating mockReturnValueOnce
const mockResponseQueue: Array<{ value?: string; error?: Error }> = [];

vi.mock('child_process', () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      const next = mockResponseQueue.shift();
      if (next?.error) {
        callback?.(next.error, { stdout: '', stderr: '' });
      } else {
        callback?.(null, { stdout: next?.value ?? '', stderr: '' });
      }
    },
  ),
  exec: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// Import the provider at the top level — the mock is already set up
import { GitHubProjectsProvider } from '@night-watch/core/board/providers/github-projects.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockExecFileSync = {
  mock: vi.mocked(execFile).mock,
  mockReturnValueOnce(value: string) {
    mockResponseQueue.push({ value });
    return this;
  },
  mockImplementationOnce(fn: () => never) {
    try {
      fn();
    } catch (err) {
      mockResponseQueue.push({ error: err instanceof Error ? err : new Error(String(err)) });
    }
    return this;
  },
};

/** Wrap a data object in the GitHub GraphQL response envelope. */
function gqlResponse<T>(data: T): string {
  return JSON.stringify({ data });
}

/** Build a viewer login GraphQL response. */
function viewerLoginResponse(login = 'octocat'): string {
  return gqlResponse({ viewer: { login } });
}

/** Build a repository owner lookup response. */
function repoOwnerResponse(
  type: 'User' | 'Organization' = 'Organization',
  id = 'owner-node-id',
  login = 'owner',
  repositoryId = 'repo-node-id',
): string {
  return gqlResponse({
    repository: {
      id: repositoryId,
      owner: { __typename: type, id, login },
    },
  });
}

/** Build a user projects list response. */
function listUserProjectsResponse(
  nodes: Array<{ id: string; number: number; title: string; url: string }>,
): string {
  return gqlResponse({
    user: {
      projectsV2: {
        nodes,
      },
    },
  });
}

/** Build a user projectV2 GraphQL response. */
function projectV2Response(
  id = 'project-node-id',
  title = 'My Board',
  url = 'https://github.com/users/octocat/projects/1',
  number = 1,
): string {
  return gqlResponse({ user: { projectV2: { id, number, title, url } } });
}

/** Build a Status field GraphQL response with the five lifecycle columns. */
function statusFieldResponse(fieldId = 'field-node-id'): string {
  return gqlResponse({
    node: {
      field: {
        id: fieldId,
        options: [
          { id: 'opt-draft', name: 'Draft' },
          { id: 'opt-ready', name: 'Ready' },
          { id: 'opt-wip', name: 'In Progress' },
          { id: 'opt-review', name: 'Review' },
          { id: 'opt-done', name: 'Done' },
        ],
      },
    },
  });
}

/** Build a project items GraphQL response. */
function makeItemsResponse(
  items: Array<{
    id: string;
    number: number;
    statusName?: string;
    title?: string;
    repo?: string;
  }>,
): string {
  return gqlResponse({
    node: {
      items: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: items.map((item) => ({
          id: `item-${item.id}`,
          content: {
            number: item.number,
            title: item.title ?? `Issue ${item.number}`,
            body: 'body',
            url: `https://github.com/${item.repo ?? 'owner/repo'}/issues/${item.number}`,
            id: `issue-node-${item.id}`,
            repository: { nameWithOwner: item.repo ?? 'owner/repo' },
            labels: { nodes: [] },
            assignees: { nodes: [] },
          },
          fieldValues: {
            nodes: item.statusName ? [{ name: item.statusName, field: { name: 'Status' } }] : [],
          },
        })),
      },
    },
  });
}

/**
 * Queue the three execFileSync calls needed to prime ensureProjectCache.
 * Returns the mock for chaining.
 */
function queueCachePrimingMocks(): void {
  mockExecFileSync
    .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
    .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
    .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer);
}

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const mockConfig = {
  enabled: true,
  provider: 'github' as const,
  projectNumber: 1,
  repo: 'owner/repo',
};

const CWD = '/tmp/test-project';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubProjectsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponseQueue.length = 0;
  });

  // -------------------------------------------------------------------------
  // setupBoard
  // -------------------------------------------------------------------------

  describe('setupBoard', () => {
    it('creates a project under repo owner and links it to the repository', async () => {
      mockExecFileSync
        // resolve repo owner
        .mockReturnValueOnce(
          repoOwnerResponse('Organization', 'owner-node-id', 'owner') as unknown as Buffer,
        )
        // findExistingProject(owner) → no match
        .mockReturnValueOnce(
          gqlResponse({
            organization: { projectsV2: { nodes: [] } },
          }) as unknown as Buffer,
        )
        // createProjectV2 mutation
        .mockReturnValueOnce(
          gqlResponse({
            createProjectV2: {
              projectV2: {
                id: 'project-node-id',
                number: 42,
                url: 'https://github.com/orgs/owner/projects/42',
                title: 'My Board',
              },
            },
          }) as unknown as Buffer,
        )
        // linkProjectV2ToRepository mutation
        .mockReturnValueOnce(
          gqlResponse({
            linkProjectV2ToRepository: {
              repository: { id: 'repo-node-id' },
            },
          }) as unknown as Buffer,
        )
        // fetchStatusField
        .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer)
        // ensureStatusColumns (reads field to validate options)
        .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer)
        // refresh status field cache
        .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer);

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const board = await provider.setupBoard('My Board');

      expect(board).toEqual({
        id: 'project-node-id',
        number: 42,
        title: 'My Board',
        url: 'https://github.com/orgs/owner/projects/42',
      });

      // Verify createProject mutation targets repo owner, not viewer
      const createCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) => a.includes('mutation CreateProject(')),
      );
      expect(createCall).toBeDefined();
      expect(createCall![1]).toContain('ownerId=owner-node-id');

      const linkCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) => a.includes('linkProjectV2ToRepository')),
      );
      expect(linkCall).toBeDefined();
      expect(linkCall![1]).toContain('repositoryId=repo-node-id');
    });

    it('reuses an existing owner project and can read columns without projectNumber in config', async () => {
      mockExecFileSync
        // resolve repo owner
        .mockReturnValueOnce(
          repoOwnerResponse('User', 'owner-node-id', 'owner') as unknown as Buffer,
        )
        // findExistingProject(owner) -> found
        .mockReturnValueOnce(
          listUserProjectsResponse([
            {
              id: 'project-node-id',
              number: 99,
              title: 'My Board',
              url: 'https://github.com/users/owner/projects/99',
            },
          ]) as unknown as Buffer,
        )
        // link existing project to repo (idempotent)
        .mockReturnValueOnce(
          gqlResponse({
            linkProjectV2ToRepository: {
              repository: { id: 'repo-node-id' },
            },
          }) as unknown as Buffer,
        )
        // ensureStatusColumns read
        .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer)
        // getColumns after setup should use cachedProjectId, no config projectNumber required
        .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer);

      const provider = new GitHubProjectsProvider(
        { enabled: true, provider: 'github', repo: 'owner/repo' },
        CWD,
      );

      const board = await provider.setupBoard('My Board');
      expect(board.number).toBe(99);

      const columns = await provider.getColumns();
      expect(columns.map((c) => c.name)).toEqual([
        'Draft',
        'Ready',
        'In Progress',
        'Review',
        'Done',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // getBoard
  // -------------------------------------------------------------------------

  describe('getBoard', () => {
    it('returns null when projectNumber is not configured', async () => {
      const provider = new GitHubProjectsProvider({ enabled: true, provider: 'github' }, CWD);
      const board = await provider.getBoard();
      expect(board).toBeNull();
      expect(vi.mocked(execFile)).not.toHaveBeenCalled();
    });

    it('returns null when the GitHub query throws', async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('gh: not authenticated');
      });

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const board = await provider.getBoard();
      expect(board).toBeNull();
    });

    it('returns board info when project is found via user query', async () => {
      mockExecFileSync
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer);

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const board = await provider.getBoard();

      expect(board).toEqual({
        id: 'project-node-id',
        number: 1,
        title: 'My Board',
        url: 'https://github.com/users/octocat/projects/1',
      });
    });
  });

  // -------------------------------------------------------------------------
  // getColumns
  // -------------------------------------------------------------------------

  describe('getColumns', () => {
    it('returns five lifecycle columns in correct order', async () => {
      queueCachePrimingMocks();

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const columns = await provider.getColumns();

      expect(columns).toHaveLength(5);
      expect(columns.map((c) => c.name)).toEqual([
        'Draft',
        'Ready',
        'In Progress',
        'Review',
        'Done',
      ]);
      expect(columns.find((c) => c.name === 'Draft')?.id).toBe('opt-draft');
    });

    it('throws when Status field is missing', async () => {
      mockExecFileSync
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
        .mockReturnValueOnce(
          gqlResponse({
            node: {
              field: null,
            },
          }) as unknown as Buffer,
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await expect(provider.getColumns()).rejects.toThrow('Status field not found');
    });

    it('throws when projectNumber is not configured', async () => {
      const provider = new GitHubProjectsProvider({ enabled: true, provider: 'github' }, CWD);
      await expect(provider.getColumns()).rejects.toThrow('No projectNumber configured');
    });
  });

  // -------------------------------------------------------------------------
  // createIssue
  // -------------------------------------------------------------------------

  describe('createIssue', () => {
    it('creates an issue and adds it to the board in Draft column by default', async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        // gh issue create → returns URL
        .mockReturnValueOnce('https://github.com/owner/repo/issues/7\n' as unknown as Buffer)
        // gh api repos/owner/repo/issues/7 --jq .node_id → returns node ID
        .mockReturnValueOnce('issue-node-id-7\n' as unknown as Buffer)
        // addProjectV2ItemById mutation
        .mockReturnValueOnce(
          gqlResponse({
            addProjectV2ItemById: { item: { id: 'item-node-id-7' } },
          }) as unknown as Buffer,
        )
        // updateProjectV2ItemFieldValue mutation (set Draft)
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item-node-id-7' },
            },
          }) as unknown as Buffer,
        )
        // gh issue view (called first inside getIssue — cache is already warm)
        .mockReturnValueOnce(
          JSON.stringify({
            number: 7,
            title: 'New Feature',
            body: 'Feature body',
            url: 'https://github.com/owner/repo/issues/7',
            id: 'issue-node-id-7',
            labels: [],
            assignees: [],
          }) as unknown as Buffer,
        )
        // getAllIssues — project items (column resolution, cache already warm)
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: '7', number: 7, title: 'New Feature', statusName: 'Draft' },
          ]) as unknown as Buffer,
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.createIssue({
        title: 'New Feature',
        body: 'Feature body',
      });

      expect(issue.number).toBe(7);
      expect(issue.title).toBe('New Feature');
      expect(issue.column).toBe('Draft');

      // Verify gh issue create was called with correct args
      const createCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[])[0] === 'issue' &&
          (c[1] as string[])[1] === 'create',
      );
      expect(createCall).toBeDefined();
      const createArgs = createCall![1] as string[];
      expect(createArgs).toContain('--title');
      expect(createArgs).toContain('New Feature');
      expect(createArgs).toContain('--repo');
      expect(createArgs).toContain('owner/repo');
    });

    it('places the issue in the specified column', async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        // gh issue create → returns URL
        .mockReturnValueOnce('https://github.com/owner/repo/issues/8\n' as unknown as Buffer)
        // gh api repos/owner/repo/issues/8 --jq .node_id
        .mockReturnValueOnce('issue-node-id-8\n' as unknown as Buffer)
        // addProjectV2ItemById
        .mockReturnValueOnce(
          gqlResponse({
            addProjectV2ItemById: { item: { id: 'item-node-id-8' } },
          }) as unknown as Buffer,
        )
        // updateProjectV2ItemFieldValue
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item-node-id-8' },
            },
          }) as unknown as Buffer,
        )
        // gh issue view (called first inside getIssue — cache is already warm)
        .mockReturnValueOnce(
          JSON.stringify({
            number: 8,
            title: 'Ready Task',
            body: 'body',
            url: 'https://github.com/owner/repo/issues/8',
            id: 'issue-node-id-8',
            labels: [],
            assignees: [],
          }) as unknown as Buffer,
        )
        // getAllIssues — project items (column resolution, cache already warm)
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: '8', number: 8, title: 'Ready Task', statusName: 'Ready' },
          ]) as unknown as Buffer,
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.createIssue({
        title: 'Ready Task',
        body: 'body',
        column: 'Ready',
      });

      expect(issue.column).toBe('Ready');

      // Verify updateProjectV2ItemFieldValue used opt-ready
      const updateCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) => a.includes('updateProjectV2ItemFieldValue')),
      );
      expect(updateCall).toBeDefined();
      const updateArgs = updateCall![1] as string[];
      expect(updateArgs).toContain('optionId=opt-ready');
    });

    it('retries without labels when GitHub reports a missing label', async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        // gh issue create with missing label -> retry
        .mockImplementationOnce(() => {
          throw new Error(
            "Command failed: gh issue create --label analytics\ncould not add label: 'analytics' not found\n",
          );
        })
        // gh issue create retry without labels -> returns URL
        .mockReturnValueOnce('https://github.com/owner/repo/issues/9\n' as unknown as Buffer)
        // gh api repos/owner/repo/issues/9 --jq .node_id
        .mockReturnValueOnce('issue-node-id-9\n' as unknown as Buffer)
        // addProjectV2ItemById
        .mockReturnValueOnce(
          gqlResponse({
            addProjectV2ItemById: { item: { id: 'item-node-id-9' } },
          }) as unknown as Buffer,
        )
        // updateProjectV2ItemFieldValue
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item-node-id-9' },
            },
          }) as unknown as Buffer,
        )
        // gh issue view
        .mockReturnValueOnce(
          JSON.stringify({
            number: 9,
            title: 'Analytics Finding',
            body: 'body',
            url: 'https://github.com/owner/repo/issues/9',
            id: 'issue-node-id-9',
            labels: [],
            assignees: [],
          }) as unknown as Buffer,
        )
        // getAllIssues
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: '9', number: 9, title: 'Analytics Finding', statusName: 'Draft' },
          ]) as unknown as Buffer,
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.createIssue({
        title: 'Analytics Finding',
        body: 'body',
        labels: ['analytics'],
      });

      expect(issue.number).toBe(9);
      expect(issue.labels).toEqual([]);

      const createCalls = mockExecFileSync.mock.calls.filter(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[])[0] === 'issue' &&
          (c[1] as string[])[1] === 'create',
      );

      expect(createCalls).toHaveLength(2);
      expect(createCalls[0]![1]).toContain('--label');
      expect(createCalls[1]![1]).not.toContain('--label');
    });
  });

  // -------------------------------------------------------------------------
  // moveIssue
  // -------------------------------------------------------------------------

  describe('moveIssue', () => {
    it('updates the Status field for the given issue', async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        // getProjectItems (single query for item lookup)
        .mockReturnValueOnce(
          makeItemsResponse([{ id: '5', number: 5, statusName: 'Draft' }]) as unknown as Buffer,
        )
        // updateProjectV2ItemFieldValue
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item-5' },
            },
          }) as unknown as Buffer,
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await provider.moveIssue(5, 'In Progress');

      // Verify updateProjectV2ItemFieldValue used opt-wip
      const updateCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) => a.includes('updateProjectV2ItemFieldValue')),
      );
      expect(updateCall).toBeDefined();
      const updateArgs = updateCall![1] as string[];
      expect(updateArgs).toContain('optionId=opt-wip');
    });

    it('throws when the issue is not on the board', async () => {
      queueCachePrimingMocks();

      // getProjectItems — empty board
      mockExecFileSync.mockReturnValueOnce(
        gqlResponse({
          node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
        }) as unknown as Buffer,
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await expect(provider.moveIssue(999, 'Done')).rejects.toThrow(
        'Issue #999 not found on the project board',
      );
    });

    it('ignores matching issue numbers from other repositories on the same project', async () => {
      queueCachePrimingMocks();

      mockExecFileSync
        .mockReturnValueOnce(
          makeItemsResponse([
            { id: 'foreign-5', number: 5, statusName: 'Draft', repo: 'other/repo' },
            { id: 'local-5', number: 5, statusName: 'Draft', repo: 'owner/repo' },
          ]) as unknown as Buffer,
        )
        .mockReturnValueOnce(
          gqlResponse({
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item-local-5' },
            },
          }) as unknown as Buffer,
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await provider.moveIssue(5, 'In Progress');

      const updateCall = mockExecFileSync.mock.calls.find(
        (c) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((a) => a.includes('updateProjectV2ItemFieldValue')),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toContain('itemId=item-local-5');
    });

    it('throws when target column is not in the option IDs', async () => {
      // Set up cache with incomplete options (missing "Done")
      mockExecFileSync
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
        .mockReturnValueOnce(
          gqlResponse({
            node: {
              field: {
                id: 'field-node-id',
                options: [
                  { id: 'opt-draft', name: 'Draft' },
                  { id: 'opt-ready', name: 'Ready' },
                  // Missing "Done" option
                ],
              },
            },
          }) as unknown as Buffer,
        );

      mockExecFileSync.mockReturnValueOnce(
        makeItemsResponse([{ id: '5', number: 5, statusName: 'Draft' }]) as unknown as Buffer,
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await expect(provider.moveIssue(5, 'Done')).rejects.toThrow(
        'Column "Done" not found on the project board',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getIssuesByColumn
  // -------------------------------------------------------------------------

  describe('getIssuesByColumn', () => {
    it('filters issues by column status', async () => {
      queueCachePrimingMocks();

      mockExecFileSync.mockReturnValueOnce(
        makeItemsResponse([
          { id: '1', number: 1, statusName: 'Draft' },
          { id: '2', number: 2, statusName: 'In Progress' },
          { id: '3', number: 3, statusName: 'In Progress' },
          { id: '4', number: 4, statusName: 'Done' },
        ]) as unknown as Buffer,
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const inProgress = await provider.getIssuesByColumn('In Progress');

      expect(inProgress).toHaveLength(2);
      expect(inProgress.every((i) => i.column === 'In Progress')).toBe(true);
      expect(inProgress.map((i) => i.number)).toEqual([2, 3]);
    });
  });

  // -------------------------------------------------------------------------
  // closeIssue
  // -------------------------------------------------------------------------

  describe('closeIssue', () => {
    it('calls gh issue close with correct arguments', async () => {
      mockExecFileSync.mockReturnValueOnce('' as unknown as Buffer);

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await provider.closeIssue(42);

      const call = mockExecFileSync.mock.calls[0];
      expect(call[0]).toBe('gh');
      const args = call[1] as string[];
      expect(args).toEqual(['issue', 'close', '42', '--repo', 'owner/repo']);
    });
  });

  // -------------------------------------------------------------------------
  // commentOnIssue
  // -------------------------------------------------------------------------

  describe('commentOnIssue', () => {
    it('calls gh issue comment with correct arguments', async () => {
      mockExecFileSync.mockReturnValueOnce('' as unknown as Buffer);

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      await provider.commentOnIssue(10, 'LGTM!');

      const call = mockExecFileSync.mock.calls[0];
      expect(call[0]).toBe('gh');
      const args = call[1] as string[];
      expect(args).toEqual(['issue', 'comment', '10', '--repo', 'owner/repo', '--body', 'LGTM!']);
    });
  });

  // -------------------------------------------------------------------------
  // getAllIssues
  // -------------------------------------------------------------------------

  describe('getAllIssues', () => {
    it('returns all issues from project items', async () => {
      queueCachePrimingMocks();

      mockExecFileSync.mockReturnValueOnce(
        makeItemsResponse([
          { id: '1', number: 1, statusName: 'Draft' },
          { id: '2', number: 2, statusName: 'Done' },
        ]) as unknown as Buffer,
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(2);
      expect(issues[0].number).toBe(1);
      expect(issues[0].column).toBe('Draft');
      expect(issues[1].number).toBe(2);
      expect(issues[1].column).toBe('Done');
    });

    it('filters out issues from other repositories on a shared project board', async () => {
      queueCachePrimingMocks();

      mockExecFileSync.mockReturnValueOnce(
        makeItemsResponse([
          { id: '1', number: 1, statusName: 'Draft', repo: 'owner/repo' },
          { id: '2', number: 2, statusName: 'Ready', repo: 'other/repo' },
          { id: '3', number: 3, statusName: 'Review', repo: 'owner/repo' },
        ]) as unknown as Buffer,
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issues = await provider.getAllIssues();

      expect(issues.map((issue) => issue.number)).toEqual([1, 3]);
      expect(issues.every((issue) => issue.url.includes('owner/repo'))).toBe(true);
    });

    it('skips non-issue items (null content)', async () => {
      queueCachePrimingMocks();

      // Provide one real issue and one draft text item with null content
      mockExecFileSync.mockReturnValueOnce(
        gqlResponse({
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'item-real',
                  content: {
                    number: 1,
                    title: 'Real Issue',
                    body: '',
                    url: 'https://github.com/owner/repo/issues/1',
                    id: 'issue-node-1',
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                  },
                  fieldValues: {
                    nodes: [{ name: 'Draft', field: { name: 'Status' } }],
                  },
                },
                {
                  id: 'item-text',
                  content: null,
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        }) as unknown as Buffer,
      );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issues = await provider.getAllIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getIssue
  // -------------------------------------------------------------------------

  describe('getIssue', () => {
    it('returns null when gh issue view fails', async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('issue not found');
      });

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.getIssue(9999);
      expect(issue).toBeNull();
    });

    it('returns issue with column resolved from project board', async () => {
      mockExecFileSync
        // 1. gh issue view — called first (no cache needed)
        .mockReturnValueOnce(
          JSON.stringify({
            number: 3,
            title: 'A PR',
            body: 'ready for review',
            url: 'https://github.com/owner/repo/issues/3',
            id: 'issue-node-3',
            labels: [{ name: 'bug' }],
            assignees: [{ login: 'dev1' }],
          }) as unknown as Buffer,
        )
        // 2-4. ensureProjectCache inside getAllIssues
        .mockReturnValueOnce(viewerLoginResponse() as unknown as Buffer)
        .mockReturnValueOnce(projectV2Response() as unknown as Buffer)
        .mockReturnValueOnce(statusFieldResponse() as unknown as Buffer)
        // 5. getAllIssues — project items (for column resolution)
        .mockReturnValueOnce(
          makeItemsResponse([{ id: '3', number: 3, statusName: 'Review' }]) as unknown as Buffer,
        );

      const provider = new GitHubProjectsProvider(mockConfig, CWD);
      const issue = await provider.getIssue(3);

      expect(issue).not.toBeNull();
      expect(issue!.number).toBe(3);
      expect(issue!.column).toBe('Review');
      expect(issue!.labels).toEqual(['bug']);
      expect(issue!.assignees).toEqual(['dev1']);
    });
  });
});
