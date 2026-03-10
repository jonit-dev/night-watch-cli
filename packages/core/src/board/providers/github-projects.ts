import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  BOARD_COLUMNS,
  BoardColumnName,
  IBoardColumn,
  IBoardInfo,
  IBoardIssue,
  IBoardProvider,
  IBoardProviderConfig,
  ICreateIssueInput,
} from '@/board/types.js';
import { getRepoNwo, getViewerLogin, graphql } from './github-graphql.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Internal GraphQL response shapes
// ---------------------------------------------------------------------------

interface IProjectV2Node {
  id: string;
  number: number;
  title: string;
  url: string;
}

interface IGetUserProjectData {
  user: { projectV2: IProjectV2Node | null } | null;
}

interface IGetOrgProjectData {
  organization: { projectV2: IProjectV2Node | null } | null;
}

interface ICreateProjectData {
  createProjectV2: {
    projectV2: {
      id: string;
      number: number;
      url: string;
      title: string;
    };
  };
}

interface IRepositoryOwnerData {
  repository: {
    id: string;
    owner: {
      __typename: 'User' | 'Organization' | string;
      id: string;
      login: string;
    };
  } | null;
}

interface IRepoOwnerInfo {
  id: string;
  login: string;
  type: 'User' | 'Organization';
}

interface IListUserProjectsData {
  user: {
    projectsV2: {
      nodes: IProjectV2Node[];
    };
  } | null;
}

interface IListOrgProjectsData {
  organization: {
    projectsV2: {
      nodes: IProjectV2Node[];
    };
  } | null;
}

interface IStatusFieldOption {
  id: string;
  name: string;
}

interface IStatusFieldData {
  node: {
    field: {
      id: string;
      options: IStatusFieldOption[];
    } | null;
  };
}

interface ICreateFieldData {
  createProjectV2Field: {
    projectV2Field: {
      id: string;
      options: IStatusFieldOption[];
    };
  };
}

interface IProjectItemsPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface IProjectItemNode {
  id: string;
  content: {
    number?: number;
    title?: string;
    body?: string;
    url?: string;
    id?: string;
    repository?: {
      nameWithOwner?: string;
    };
    labels?: { nodes: Array<{ name: string }> };
    assignees?: { nodes: Array<{ login: string }> };
  } | null;
  fieldValues: {
    nodes: Array<{
      name?: string;
      field?: { name?: string };
    }>;
  };
}

interface IProjectItemsData {
  node: {
    items: {
      pageInfo: IProjectItemsPageInfo;
      nodes: IProjectItemNode[];
    };
  };
}

interface IAddItemData {
  addProjectV2ItemById: { item: { id: string } };
}

interface IUpdateItemFieldData {
  updateProjectV2ItemFieldValue: { projectV2Item: { id: string } };
}

// ---------------------------------------------------------------------------
// Raw issue JSON from gh CLI
// ---------------------------------------------------------------------------

interface IRawIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  id: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
}

// ---------------------------------------------------------------------------
// GitHubProjectsProvider
// ---------------------------------------------------------------------------

export class GitHubProjectsProvider implements IBoardProvider {
  private readonly config: IBoardProviderConfig;
  private readonly cwd: string;

  private cachedProjectId: string | null = null;
  private cachedFieldId: string | null = null;
  private cachedOptionIds: Map<string, string> = new Map();
  private cachedOwner: IRepoOwnerInfo | null = null;
  private cachedRepositoryId: string | null = null;
  private cachedRepoNameWithOwner: string | null = null;

  constructor(config: IBoardProviderConfig, cwd: string) {
    this.config = config;
    this.cwd = cwd;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async getRepo(): Promise<string> {
    if (this.cachedRepoNameWithOwner) {
      return this.cachedRepoNameWithOwner;
    }

    this.cachedRepoNameWithOwner = this.config.repo ?? (await getRepoNwo(this.cwd));
    return this.cachedRepoNameWithOwner;
  }

  private async getRepoParts(): Promise<{ owner: string; name: string }> {
    const repo = await this.getRepo();
    const [owner, name] = repo.split('/');
    if (!owner || !name) {
      throw new Error(`Invalid repository slug: "${repo}". Expected "owner/repo".`);
    }
    return { owner, name };
  }

  private normalizeRepoName(repo: string): string {
    return repo.trim().toLowerCase();
  }

  private isCurrentRepoItem(content: IProjectItemNode['content'], repo: string): boolean {
    const repoNameWithOwner = content?.repository?.nameWithOwner;
    if (!repoNameWithOwner) {
      return true;
    }

    return this.normalizeRepoName(repoNameWithOwner) === this.normalizeRepoName(repo);
  }

  private async getRepoOwnerLogin(): Promise<string> {
    return (await this.getRepoParts()).owner;
  }

  private async getRepoOwner(): Promise<IRepoOwnerInfo> {
    if (this.cachedOwner && this.cachedRepositoryId) {
      return this.cachedOwner;
    }

    const { owner, name } = await this.getRepoParts();
    const data = await graphql<IRepositoryOwnerData>(
      `
        query ResolveRepoOwner($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            id
            owner {
              __typename
              id
              login
            }
          }
        }
      `,
      { owner, name },
      this.cwd,
    );

    if (!data.repository) {
      throw new Error(`Repository ${owner}/${name} not found.`);
    }

    const ownerNode = data.repository.owner;
    if (
      !ownerNode ||
      (ownerNode.__typename !== 'User' && ownerNode.__typename !== 'Organization')
    ) {
      throw new Error(`Failed to resolve repository owner for ${owner}/${name}.`);
    }

    this.cachedRepositoryId = data.repository.id;
    this.cachedOwner = {
      id: ownerNode.id,
      login: ownerNode.login,
      type: ownerNode.__typename,
    };
    return this.cachedOwner;
  }

  private async getRepositoryNodeId(): Promise<string> {
    if (this.cachedRepositoryId) {
      return this.cachedRepositoryId;
    }
    await this.getRepoOwner();
    if (!this.cachedRepositoryId) {
      throw new Error(`Failed to resolve repository ID for ${await this.getRepo()}.`);
    }
    return this.cachedRepositoryId;
  }

  private async linkProjectToRepository(projectId: string): Promise<void> {
    const repositoryId = await this.getRepositoryNodeId();
    try {
      await graphql<{ linkProjectV2ToRepository: { repository: { id: string } } }>(
        `
          mutation LinkProjectToRepository($projectId: ID!, $repositoryId: ID!) {
            linkProjectV2ToRepository(
              input: { projectId: $projectId, repositoryId: $repositoryId }
            ) {
              repository {
                id
              }
            }
          }
        `,
        { projectId, repositoryId },
        this.cwd,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const normalized = message.toLowerCase();
      if (normalized.includes('already') && normalized.includes('project')) {
        return;
      }
      throw err;
    }
  }

  private async fetchStatusField(projectId: string): Promise<{
    fieldId: string;
    optionIds: Map<string, string>;
  }> {
    const fieldData = await graphql<IStatusFieldData>(
      `
        query GetStatusField($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              field(name: "Status") {
                ... on ProjectV2SingleSelectField {
                  id
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      `,
      { projectId },
      this.cwd,
    );

    const field = fieldData.node?.field;
    if (!field) {
      throw new Error(
        `Status field not found on project ${projectId}. ` +
          `Run \`night-watch board setup\` to create it.`,
      );
    }

    return {
      fieldId: field.id,
      optionIds: new Map(field.options.map((o) => [o.name, o.id])),
    };
  }

  /**
   * Fetch and cache the project node ID, Status field ID, and option IDs.
   * Throws if the project cannot be found or has no Status field.
   */
  private async ensureProjectCache(): Promise<{
    projectId: string;
    fieldId: string;
    optionIds: Map<string, string>;
  }> {
    if (
      this.cachedProjectId !== null &&
      this.cachedFieldId !== null &&
      this.cachedOptionIds.size > 0
    ) {
      return {
        projectId: this.cachedProjectId,
        fieldId: this.cachedFieldId,
        optionIds: this.cachedOptionIds,
      };
    }

    if (this.cachedProjectId !== null) {
      const statusField = await this.fetchStatusField(this.cachedProjectId);
      this.cachedFieldId = statusField.fieldId;
      this.cachedOptionIds = statusField.optionIds;
      return {
        projectId: this.cachedProjectId,
        fieldId: this.cachedFieldId,
        optionIds: this.cachedOptionIds,
      };
    }

    const projectNumber = this.config.projectNumber;
    if (!projectNumber) {
      throw new Error('No projectNumber configured. Run `night-watch board setup` first.');
    }

    const ownerLogins = new Set<string>([await this.getRepoOwnerLogin()]);
    try {
      ownerLogins.add(await getViewerLogin(this.cwd));
    } catch {
      // ignore fallback if viewer lookup fails
    }

    let projectNode: IProjectV2Node | null = null;
    for (const login of ownerLogins) {
      projectNode = await this.fetchProjectNode(login, projectNumber);
      if (projectNode) {
        break;
      }
    }

    if (!projectNode) {
      throw new Error(
        `GitHub Project #${projectNumber} not found for repository owner "${await this.getRepoOwnerLogin()}".`,
      );
    }

    this.cachedProjectId = projectNode.id;
    const statusField = await this.fetchStatusField(projectNode.id);
    this.cachedFieldId = statusField.fieldId;
    this.cachedOptionIds = statusField.optionIds;

    return {
      projectId: this.cachedProjectId,
      fieldId: this.cachedFieldId,
      optionIds: this.cachedOptionIds,
    };
  }

  /** Try user query first, fall back to org query. */
  private async fetchProjectNode(
    login: string,
    projectNumber: number,
  ): Promise<IProjectV2Node | null> {
    try {
      const userData = await graphql<IGetUserProjectData>(
        `
          query GetProject($login: String!, $number: Int!) {
            user(login: $login) {
              projectV2(number: $number) {
                id
                number
                title
                url
              }
            }
          }
        `,
        { login, number: projectNumber },
        this.cwd,
      );

      if (userData.user?.projectV2) {
        return userData.user.projectV2;
      }
    } catch {
      // Swallow — try org query next
    }

    try {
      const orgData = await graphql<IGetOrgProjectData>(
        `
          query GetOrgProject($login: String!, $number: Int!) {
            organization(login: $login) {
              projectV2(number: $number) {
                id
                number
                title
                url
              }
            }
          }
        `,
        { login, number: projectNumber },
        this.cwd,
      );

      if (orgData.organization?.projectV2) {
        return orgData.organization.projectV2;
      }
    } catch {
      // Swallow
    }

    return null;
  }

  /**
   * Parse a raw project item node into IBoardIssue, returning null for items
   * that are not issues.
   */
  private parseItem(item: IProjectItemNode, repo: string): IBoardIssue | null {
    const content = item.content;
    if (!content || content.number === undefined) {
      return null;
    }

    if (!this.isCurrentRepoItem(content, repo)) {
      return null;
    }

    // Find the Status column value from the field values
    let column: BoardColumnName | null = null;
    for (const fv of item.fieldValues.nodes) {
      if (fv.field?.name === 'Status' && fv.name) {
        const candidate = fv.name as BoardColumnName;
        if (BOARD_COLUMNS.includes(candidate)) {
          column = candidate;
        }
      }
    }

    return {
      id: content.id ?? item.id,
      number: content.number,
      title: content.title ?? '',
      body: content.body ?? '',
      url: content.url ?? '',
      column,
      labels: content.labels?.nodes.map((l) => l.name) ?? [],
      assignees: content.assignees?.nodes.map((a) => a.login) ?? [],
    };
  }

  /**
   * Fetch ALL items from a GitHub ProjectV2 using cursor-based pagination.
   *
   * The API caps each page at 100 items.  We loop until `hasNextPage` is false,
   * accumulating every item node so callers never see a truncated board.
   */
  private async fetchAllProjectItems(projectId: string): Promise<IProjectItemNode[]> {
    const allNodes: IProjectItemNode[] = [];
    let cursor: string | null = null;

    const query = `query GetProjectItems($projectId: ID!, $cursor: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              content {
                ... on Issue {
                  number
                  title
                  body
                  url
                  id
                  repository {
                    nameWithOwner
                  }
                  labels(first: 10) { nodes { name } }
                  assignees(first: 10) { nodes { login } }
                }
              }
              fieldValues(first: 10) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`;

    do {
      const variables: Record<string, unknown> = { projectId };
      if (cursor !== null) {
        variables.cursor = cursor;
      }
      const data = await graphql<IProjectItemsData>(query, variables, this.cwd);
      const page = data.node.items;
      allNodes.push(...page.nodes);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor !== null);

    return allNodes;
  }

  /**
   * Fetch project items for moveIssue — only needs id, content.number, and
   * fieldValues.  Uses the same paginated approach to ensure items beyond
   * position 100 are reachable.
   */
  private async fetchAllProjectItemsForMove(projectId: string): Promise<IProjectItemNode[]> {
    const allNodes: IProjectItemNode[] = [];
    let cursor: string | null = null;

    const query = `query GetProjectItemsForMove($projectId: ID!, $cursor: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              content {
                ... on Issue {
                  number
                  repository {
                    nameWithOwner
                  }
                }
              }
              fieldValues(first: 10) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`;

    do {
      const variables: Record<string, unknown> = { projectId };
      if (cursor !== null) {
        variables.cursor = cursor;
      }
      const data = await graphql<IProjectItemsData>(query, variables, this.cwd);
      const page = data.node.items;
      allNodes.push(...page.nodes);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor !== null);

    return allNodes;
  }

  // -------------------------------------------------------------------------
  // IBoardProvider implementation
  // -------------------------------------------------------------------------

  /**
   * Find an existing project by title among the repository owner's first 50 projects.
   * Returns null if not found.
   */
  private async findExistingProject(
    owner: IRepoOwnerInfo,
    title: string,
  ): Promise<IProjectV2Node | null> {
    try {
      if (owner.type === 'User') {
        const data = await graphql<IListUserProjectsData>(
          `
            query ListUserProjects($login: String!) {
              user(login: $login) {
                projectsV2(first: 50) {
                  nodes {
                    id
                    number
                    title
                    url
                  }
                }
              }
            }
          `,
          { login: owner.login },
          this.cwd,
        );
        return data.user?.projectsV2.nodes.find((p) => p.title === title) ?? null;
      }

      const data = await graphql<IListOrgProjectsData>(
        `
          query ListOrgProjects($login: String!) {
            organization(login: $login) {
              projectsV2(first: 50) {
                nodes {
                  id
                  number
                  title
                  url
                }
              }
            }
          }
        `,
        { login: owner.login },
        this.cwd,
      );
      return data.organization?.projectsV2.nodes.find((p) => p.title === title) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Ensure the Status field on an existing project has all five Night Watch
   * lifecycle columns, updating it via GraphQL if any are missing.
   */
  private async ensureStatusColumns(projectId: string): Promise<void> {
    const fieldData = await graphql<IStatusFieldData>(
      `
        query GetStatusField($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              field(name: "Status") {
                ... on ProjectV2SingleSelectField {
                  id
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      `,
      { projectId },
      this.cwd,
    );

    const field = fieldData.node?.field;
    if (!field) return;

    const existing = new Set(field.options.map((o) => o.name));
    const required = ['Draft', 'Ready', 'In Progress', 'Review', 'Done'];
    const missing = required.filter((n) => !existing.has(n));
    if (missing.length === 0) return;

    // Rebuild full options list in the correct order
    interface IUpdateFieldData {
      updateProjectV2Field: {
        projectV2Field: { id: string; options: IStatusFieldOption[] };
      };
    }
    const colorMap: Record<string, string> = {
      Draft: 'GRAY',
      Ready: 'BLUE',
      'In Progress': 'YELLOW',
      Review: 'ORANGE',
      Done: 'GREEN',
    };
    const allOptions = required.map((name) => ({
      name,
      color: colorMap[name],
      description: '',
    }));
    await graphql<IUpdateFieldData>(
      `
        mutation UpdateField($fieldId: ID!) {
          updateProjectV2Field(
            input: {
              fieldId: $fieldId
              singleSelectOptions: [
                { name: "Draft", color: GRAY, description: "" }
                { name: "Ready", color: BLUE, description: "" }
                { name: "In Progress", color: YELLOW, description: "" }
                { name: "Review", color: ORANGE, description: "" }
                { name: "Done", color: GREEN, description: "" }
              ]
            }
          ) {
            projectV2Field {
              ... on ProjectV2SingleSelectField {
                id
                options {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      { fieldId: field.id, allOptions },
      this.cwd,
    );
  }

  async setupBoard(title: string): Promise<IBoardInfo> {
    const owner = await this.getRepoOwner();

    // Find or create — avoid duplicating boards on re-runs
    const existing = await this.findExistingProject(owner, title);
    if (existing) {
      this.cachedProjectId = existing.id;
      await this.linkProjectToRepository(existing.id);
      await this.ensureStatusColumns(existing.id);
      return { id: existing.id, number: existing.number, title: existing.title, url: existing.url };
    }

    // Create the project
    const createData = await graphql<ICreateProjectData>(
      `
        mutation CreateProject($ownerId: ID!, $title: String!) {
          createProjectV2(input: { ownerId: $ownerId, title: $title }) {
            projectV2 {
              id
              number
              url
              title
            }
          }
        }
      `,
      { ownerId: owner.id, title },
      this.cwd,
    );

    const project = createData.createProjectV2.projectV2;
    this.cachedProjectId = project.id;
    await this.linkProjectToRepository(project.id);

    // New projects may already have a default Status field. Reuse/update it.
    try {
      const statusField = await this.fetchStatusField(project.id);
      this.cachedFieldId = statusField.fieldId;
      this.cachedOptionIds = statusField.optionIds;
      await this.ensureStatusColumns(project.id);
      const refreshed = await this.fetchStatusField(project.id);
      this.cachedFieldId = refreshed.fieldId;
      this.cachedOptionIds = refreshed.optionIds;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('Status field not found')) {
        throw err;
      }

      const createFieldData = await graphql<ICreateFieldData>(
        `
          mutation CreateStatusField($projectId: ID!) {
            createProjectV2Field(
              input: {
                projectId: $projectId
                dataType: SINGLE_SELECT
                name: "Status"
                singleSelectOptions: [
                  { name: "Draft", color: GRAY, description: "" }
                  { name: "Ready", color: BLUE, description: "" }
                  { name: "In Progress", color: YELLOW, description: "" }
                  { name: "Review", color: ORANGE, description: "" }
                  { name: "Done", color: GREEN, description: "" }
                ]
              }
            ) {
              projectV2Field {
                ... on ProjectV2SingleSelectField {
                  id
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
        { projectId: project.id },
        this.cwd,
      );

      const field = createFieldData.createProjectV2Field.projectV2Field;
      this.cachedFieldId = field.id;
      this.cachedOptionIds = new Map(field.options.map((o) => [o.name, o.id]));
    }

    return { id: project.id, number: project.number, title: project.title, url: project.url };
  }

  async getBoard(): Promise<IBoardInfo | null> {
    const projectNumber = this.config.projectNumber;
    if (!projectNumber) {
      return null;
    }

    try {
      const ownerLogins = new Set<string>([await this.getRepoOwnerLogin()]);
      try {
        ownerLogins.add(await getViewerLogin(this.cwd));
      } catch {
        // ignore fallback if viewer lookup fails
      }

      let node: IProjectV2Node | null = null;
      for (const login of ownerLogins) {
        node = await this.fetchProjectNode(login, projectNumber);
        if (node) {
          break;
        }
      }
      if (!node) {
        return null;
      }
      return { id: node.id, number: node.number, title: node.title, url: node.url };
    } catch {
      return null;
    }
  }

  async getColumns(): Promise<IBoardColumn[]> {
    const { fieldId, optionIds } = await this.ensureProjectCache();
    return BOARD_COLUMNS.map((name) => ({
      id: optionIds.get(name) ?? fieldId,
      name,
    }));
  }

  async createIssue(input: ICreateIssueInput): Promise<IBoardIssue> {
    const repo = await this.getRepo();
    const { projectId, fieldId, optionIds } = await this.ensureProjectCache();

    // Create the issue via gh CLI (outputs URL, e.g. https://github.com/owner/repo/issues/123)
    const issueArgs = [
      'issue',
      'create',
      '--title',
      input.title,
      '--body',
      input.body,
      '--repo',
      repo,
    ];

    if (input.labels && input.labels.length > 0) {
      issueArgs.push('--label', input.labels.join(','));
    }

    const { stdout: issueUrlRaw } = await execFileAsync('gh', issueArgs, {
      cwd: this.cwd,
      encoding: 'utf-8',
    });
    const issueUrl = issueUrlRaw.trim();

    const issueNumber = parseInt(issueUrl.split('/').pop() ?? '', 10);
    if (!issueNumber) {
      throw new Error(`Failed to parse issue number from URL: ${issueUrl}`);
    }

    // Fetch the node ID needed for the GraphQL project mutation
    const [owner, repoName] = repo.split('/');
    const { stdout: nodeIdRaw } = await execFileAsync(
      'gh',
      ['api', `repos/${owner}/${repoName}/issues/${issueNumber}`, '--jq', '.node_id'],
      { cwd: this.cwd, encoding: 'utf-8' },
    );
    const nodeIdOutput = nodeIdRaw.trim();

    const issueJson = { number: issueNumber, id: nodeIdOutput, url: issueUrl };

    // Add the issue to the project board
    const addData = await graphql<IAddItemData>(
      `
        mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
            item {
              id
            }
          }
        }
      `,
      { projectId, contentId: issueJson.id },
      this.cwd,
    );

    const itemId = addData.addProjectV2ItemById.item.id;
    const targetColumn = input.column ?? 'Draft';
    const optionId = optionIds.get(targetColumn);

    if (optionId) {
      await graphql<IUpdateItemFieldData>(
        `
          mutation UpdateItemField(
            $projectId: ID!
            $itemId: ID!
            $fieldId: ID!
            $optionId: String!
          ) {
            updateProjectV2ItemFieldValue(
              input: {
                projectId: $projectId
                itemId: $itemId
                fieldId: $fieldId
                value: { singleSelectOptionId: $optionId }
              }
            ) {
              projectV2Item {
                id
              }
            }
          }
        `,
        { projectId, itemId, fieldId, optionId },
        this.cwd,
      );
    }

    // Fetch the full issue details so we can return a complete IBoardIssue
    const fullIssue = await this.getIssue(issueJson.number);
    if (fullIssue) {
      return { ...fullIssue, column: targetColumn };
    }

    return {
      id: issueJson.id,
      number: issueJson.number,
      title: input.title,
      body: input.body,
      url: issueJson.url,
      column: targetColumn,
      labels: input.labels ?? [],
      assignees: [],
    };
  }

  async getIssue(issueNumber: number): Promise<IBoardIssue | null> {
    const repo = await this.getRepo();

    let rawIssue: IRawIssue;
    try {
      const { stdout: output } = await execFileAsync(
        'gh',
        [
          'issue',
          'view',
          String(issueNumber),
          '--repo',
          repo,
          '--json',
          'number,title,body,url,id,labels,assignees',
        ],
        { cwd: this.cwd, encoding: 'utf-8' },
      );
      rawIssue = JSON.parse(output) as IRawIssue;
    } catch {
      return null;
    }

    // Find which column this issue sits in by scanning all board items
    let column: BoardColumnName | null = null;
    try {
      const allIssues = await this.getAllIssues();
      const match = allIssues.find((i) => i.number === issueNumber);
      if (match) {
        column = match.column;
      }
    } catch {
      // Column stays null
    }

    return {
      id: rawIssue.id,
      number: rawIssue.number,
      title: rawIssue.title,
      body: rawIssue.body,
      url: rawIssue.url,
      column,
      labels: rawIssue.labels.map((l) => l.name),
      assignees: rawIssue.assignees.map((a) => a.login),
    };
  }

  async getIssuesByColumn(column: BoardColumnName): Promise<IBoardIssue[]> {
    const all = await this.getAllIssues();
    return all.filter((issue) => issue.column === column);
  }

  async getAllIssues(): Promise<IBoardIssue[]> {
    const repo = await this.getRepo();
    const { projectId } = await this.ensureProjectCache();
    const allNodes = await this.fetchAllProjectItems(projectId);

    const results: IBoardIssue[] = [];
    for (const item of allNodes) {
      const parsed = this.parseItem(item, repo);
      if (parsed) {
        results.push(parsed);
      }
    }
    return results;
  }

  async moveIssue(issueNumber: number, targetColumn: BoardColumnName): Promise<void> {
    const repo = await this.getRepo();
    const { projectId, fieldId, optionIds } = await this.ensureProjectCache();

    // Fetch all project items (paginated) to find the item node ID for the target issue
    const allNodes = await this.fetchAllProjectItemsForMove(projectId);

    // Find the project item for this issue number
    const itemNode = allNodes.find(
      (n) => n.content?.number === issueNumber && this.isCurrentRepoItem(n.content, repo),
    );
    if (!itemNode) {
      throw new Error(`Issue #${issueNumber} not found on the project board.`);
    }

    const optionId = optionIds.get(targetColumn);
    if (!optionId) {
      throw new Error(`Column "${targetColumn}" not found on the project board.`);
    }

    await graphql<IUpdateItemFieldData>(
      `
        mutation UpdateItemField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { singleSelectOptionId: $optionId }
            }
          ) {
            projectV2Item {
              id
            }
          }
        }
      `,
      { projectId, itemId: itemNode.id, fieldId, optionId },
      this.cwd,
    );
  }

  async closeIssue(issueNumber: number): Promise<void> {
    const repo = await this.getRepo();
    await execFileAsync('gh', ['issue', 'close', String(issueNumber), '--repo', repo], {
      cwd: this.cwd,
      encoding: 'utf-8',
    });
  }

  async commentOnIssue(issueNumber: number, body: string): Promise<void> {
    const repo = await this.getRepo();
    await execFileAsync(
      'gh',
      ['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body],
      { cwd: this.cwd, encoding: 'utf-8' },
    );
  }
}
