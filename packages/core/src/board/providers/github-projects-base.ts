import { BOARD_COLUMNS, BoardColumnName, IBoardIssue, IBoardProviderConfig } from '@/board/types.js';
import { getRepoNwo, getViewerLogin, graphql } from './github-graphql.js';
import type {
  IGetOrgProjectData,
  IGetUserProjectData,
  IListOrgProjectsData,
  IListUserProjectsData,
  IProjectItemNode,
  IProjectItemsData,
  IProjectV2Node,
  IRepoOwnerInfo,
  IRepositoryOwnerData,
  IStatusFieldData,
  IUpdateFieldData,
  IUpdateItemFieldData,
} from './github-projects-types.js';

export abstract class GitHubProjectsBase {
  protected readonly config: IBoardProviderConfig;
  protected readonly cwd: string;

  protected cachedProjectId: string | null = null;
  protected cachedFieldId: string | null = null;
  protected cachedOptionIds: Map<string, string> = new Map();

  private cachedOwner: IRepoOwnerInfo | null = null;
  private cachedRepositoryId: string | null = null;
  private cachedRepoNameWithOwner: string | null = null;

  constructor(config: IBoardProviderConfig, cwd: string) {
    this.config = config;
    this.cwd = cwd;
  }

  // -------------------------------------------------------------------------
  // Repo resolution
  // -------------------------------------------------------------------------

  protected async getRepo(): Promise<string> {
    if (this.cachedRepoNameWithOwner) return this.cachedRepoNameWithOwner;
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

  protected isCurrentRepoItem(content: IProjectItemNode['content'], repo: string): boolean {
    const repoNameWithOwner = content?.repository?.nameWithOwner;
    if (!repoNameWithOwner) return true;
    return this.normalizeRepoName(repoNameWithOwner) === this.normalizeRepoName(repo);
  }

  private async getRepoOwnerLogin(): Promise<string> {
    return (await this.getRepoParts()).owner;
  }

  protected async getRepoOwner(): Promise<IRepoOwnerInfo> {
    if (this.cachedOwner && this.cachedRepositoryId) return this.cachedOwner;

    const { owner, name } = await this.getRepoParts();
    const data = await graphql<IRepositoryOwnerData>(
      `query ResolveRepoOwner($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          owner { __typename id login }
        }
      }`,
      { owner, name },
      this.cwd,
    );

    if (!data.repository) throw new Error(`Repository ${owner}/${name} not found.`);

    const ownerNode = data.repository.owner;
    if (!ownerNode || (ownerNode.__typename !== 'User' && ownerNode.__typename !== 'Organization')) {
      throw new Error(`Failed to resolve repository owner for ${owner}/${name}.`);
    }

    this.cachedRepositoryId = data.repository.id;
    this.cachedOwner = { id: ownerNode.id, login: ownerNode.login, type: ownerNode.__typename };
    return this.cachedOwner;
  }

  private async getRepositoryNodeId(): Promise<string> {
    if (this.cachedRepositoryId) return this.cachedRepositoryId;
    await this.getRepoOwner();
    if (!this.cachedRepositoryId) {
      throw new Error(`Failed to resolve repository ID for ${await this.getRepo()}.`);
    }
    return this.cachedRepositoryId;
  }

  // -------------------------------------------------------------------------
  // Project discovery & caching
  // -------------------------------------------------------------------------

  protected async resolveProjectNode(projectNumber: number): Promise<IProjectV2Node | null> {
    const ownerLogins = new Set<string>([await this.getRepoOwnerLogin()]);
    try {
      ownerLogins.add(await getViewerLogin(this.cwd));
    } catch {
      // ignore fallback if viewer lookup fails
    }

    for (const login of ownerLogins) {
      const node = await this.fetchProjectNode(login, projectNumber);
      if (node) return node;
    }
    return null;
  }

  /** Try user query first, fall back to org query. */
  private async fetchProjectNode(login: string, projectNumber: number): Promise<IProjectV2Node | null> {
    try {
      const userData = await graphql<IGetUserProjectData>(
        `query GetProject($login: String!, $number: Int!) {
          user(login: $login) {
            projectV2(number: $number) { id number title url }
          }
        }`,
        { login, number: projectNumber },
        this.cwd,
      );
      if (userData.user?.projectV2) return userData.user.projectV2;
    } catch {
      // Swallow — try org query next
    }

    try {
      const orgData = await graphql<IGetOrgProjectData>(
        `query GetOrgProject($login: String!, $number: Int!) {
          organization(login: $login) {
            projectV2(number: $number) { id number title url }
          }
        }`,
        { login, number: projectNumber },
        this.cwd,
      );
      if (orgData.organization?.projectV2) return orgData.organization.projectV2;
    } catch {
      // Swallow
    }

    return null;
  }

  protected async ensureProjectCache(): Promise<{
    projectId: string;
    fieldId: string;
    optionIds: Map<string, string>;
  }> {
    if (this.cachedProjectId !== null && this.cachedFieldId !== null && this.cachedOptionIds.size > 0) {
      return { projectId: this.cachedProjectId, fieldId: this.cachedFieldId, optionIds: this.cachedOptionIds };
    }

    if (this.cachedProjectId !== null) {
      const statusField = await this.fetchStatusField(this.cachedProjectId);
      this.cachedFieldId = statusField.fieldId;
      this.cachedOptionIds = statusField.optionIds;
      return { projectId: this.cachedProjectId, fieldId: this.cachedFieldId, optionIds: this.cachedOptionIds };
    }

    const projectNumber = this.config.projectNumber;
    if (!projectNumber) {
      throw new Error('No projectNumber configured. Run `night-watch board setup` first.');
    }

    const projectNode = await this.resolveProjectNode(projectNumber);
    if (!projectNode) {
      throw new Error(
        `GitHub Project #${projectNumber} not found for repository owner "${await this.getRepoOwnerLogin()}".`,
      );
    }

    this.cachedProjectId = projectNode.id;
    const statusField = await this.fetchStatusField(projectNode.id);
    this.cachedFieldId = statusField.fieldId;
    this.cachedOptionIds = statusField.optionIds;

    return { projectId: this.cachedProjectId, fieldId: this.cachedFieldId, optionIds: this.cachedOptionIds };
  }

  // -------------------------------------------------------------------------
  // Status field management
  // -------------------------------------------------------------------------

  protected async fetchStatusField(projectId: string): Promise<{
    fieldId: string;
    optionIds: Map<string, string>;
  }> {
    const fieldData = await graphql<IStatusFieldData>(
      `query GetStatusField($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                options { id name }
              }
            }
          }
        }
      }`,
      { projectId },
      this.cwd,
    );

    const field = fieldData.node?.field;
    if (!field) {
      throw new Error(
        `Status field not found on project ${projectId}. Run \`night-watch board setup\` to create it.`,
      );
    }

    return { fieldId: field.id, optionIds: new Map(field.options.map((o) => [o.name, o.id])) };
  }

  protected async ensureStatusColumns(projectId: string): Promise<void> {
    const fieldData = await graphql<IStatusFieldData>(
      `query GetStatusField($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                options { id name }
              }
            }
          }
        }
      }`,
      { projectId },
      this.cwd,
    );

    const field = fieldData.node?.field;
    if (!field) return;

    const existing = new Set(field.options.map((o) => o.name));
    const required = ['Draft', 'Ready', 'In Progress', 'Review', 'Done'];
    if (required.every((n) => existing.has(n))) return;

    await graphql<IUpdateFieldData>(
      `mutation UpdateField($fieldId: ID!) {
        updateProjectV2Field(input: {
          fieldId: $fieldId
          singleSelectOptions: [
            { name: "Draft",       color: GRAY,   description: "" }
            { name: "Ready",       color: BLUE,   description: "" }
            { name: "In Progress", color: YELLOW, description: "" }
            { name: "Review",      color: ORANGE, description: "" }
            { name: "Done",        color: GREEN,  description: "" }
          ]
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField { id options { id name } }
          }
        }
      }`,
      { fieldId: field.id },
      this.cwd,
    );
  }

  protected async linkProjectToRepository(projectId: string): Promise<void> {
    const repositoryId = await this.getRepositoryNodeId();
    try {
      await graphql<{ linkProjectV2ToRepository: { repository: { id: string } } }>(
        `mutation LinkProjectToRepository($projectId: ID!, $repositoryId: ID!) {
          linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
            repository { id }
          }
        }`,
        { projectId, repositoryId },
        this.cwd,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('already') && message.toLowerCase().includes('project')) return;
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Project items
  // -------------------------------------------------------------------------

  private async paginateProjectItems(query: string, projectId: string): Promise<IProjectItemNode[]> {
    const allNodes: IProjectItemNode[] = [];
    let cursor: string | null = null;

    do {
      const variables: Record<string, unknown> = { projectId };
      if (cursor !== null) variables.cursor = cursor;
      const data = await graphql<IProjectItemsData>(query, variables, this.cwd);
      const page = data.node.items;
      allNodes.push(...page.nodes);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor !== null);

    return allNodes;
  }

  protected async fetchAllProjectItems(projectId: string): Promise<IProjectItemNode[]> {
    return this.paginateProjectItems(
      `query GetProjectItems($projectId: ID!, $cursor: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content {
                  ... on Issue {
                    number title body url id
                    repository { nameWithOwner }
                    labels(first: 10) { nodes { name } }
                    assignees(first: 10) { nodes { login } }
                  }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      projectId,
    );
  }

  protected parseItem(item: IProjectItemNode, repo: string): IBoardIssue | null {
    const content = item.content;
    if (!content || content.number === undefined) return null;
    if (!this.isCurrentRepoItem(content, repo)) return null;

    let column: BoardColumnName | null = null;
    for (const fv of item.fieldValues.nodes) {
      if (fv.field?.name === 'Status' && fv.name) {
        const candidate = fv.name as BoardColumnName;
        if (BOARD_COLUMNS.includes(candidate)) column = candidate;
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

  protected async setItemStatus(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void> {
    await graphql<IUpdateItemFieldData>(
      `mutation UpdateItemField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item { id }
        }
      }`,
      { projectId, itemId, fieldId, optionId },
      this.cwd,
    );
  }

  // -------------------------------------------------------------------------
  // Project listing
  // -------------------------------------------------------------------------

  protected async findExistingProject(owner: IRepoOwnerInfo, title: string): Promise<IProjectV2Node | null> {
    try {
      if (owner.type === 'User') {
        const data = await graphql<IListUserProjectsData>(
          `query ListUserProjects($login: String!) {
            user(login: $login) {
              projectsV2(first: 50) { nodes { id number title url } }
            }
          }`,
          { login: owner.login },
          this.cwd,
        );
        return data.user?.projectsV2.nodes.find((p) => p.title === title) ?? null;
      }

      const data = await graphql<IListOrgProjectsData>(
        `query ListOrgProjects($login: String!) {
          organization(login: $login) {
            projectsV2(first: 50) { nodes { id number title url } }
          }
        }`,
        { login: owner.login },
        this.cwd,
      );
      return data.organization?.projectsV2.nodes.find((p) => p.title === title) ?? null;
    } catch {
      return null;
    }
  }
}
