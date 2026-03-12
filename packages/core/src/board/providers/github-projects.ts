import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  BOARD_COLUMNS,
  BoardColumnName,
  IBoardColumn,
  IBoardInfo,
  IBoardIssue,
  IBoardProvider,
  ICreateIssueInput,
} from '@/board/types.js';
import { graphql } from './github-graphql.js';
import { GitHubProjectsBase } from './github-projects-base.js';
import type { IAddItemData, ICreateFieldData, ICreateProjectData, IRawIssue } from './github-projects-types.js';

const execFileAsync = promisify(execFile);

export class GitHubProjectsProvider extends GitHubProjectsBase implements IBoardProvider {
  async setupBoard(title: string): Promise<IBoardInfo> {
    const owner = await this.getRepoOwner();

    const existing = await this.findExistingProject(owner, title);
    if (existing) {
      this.cachedProjectId = existing.id;
      await this.linkProjectToRepository(existing.id);
      await this.ensureStatusColumns(existing.id);
      return { id: existing.id, number: existing.number, title: existing.title, url: existing.url };
    }

    const createData = await graphql<ICreateProjectData>(
      `mutation CreateProject($ownerId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, title: $title }) {
          projectV2 { id number url title }
        }
      }`,
      { ownerId: owner.id, title },
      this.cwd,
    );

    const project = createData.createProjectV2.projectV2;
    this.cachedProjectId = project.id;
    await this.linkProjectToRepository(project.id);

    // New projects may already have a default Status field — reuse/update it.
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
      if (!message.includes('Status field not found')) throw err;

      const createFieldData = await graphql<ICreateFieldData>(
        `mutation CreateStatusField($projectId: ID!) {
          createProjectV2Field(input: {
            projectId: $projectId
            dataType: SINGLE_SELECT
            name: "Status"
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
    if (!projectNumber) return null;
    try {
      const node = await this.resolveProjectNode(projectNumber);
      if (!node) return null;
      return { id: node.id, number: node.number, title: node.title, url: node.url };
    } catch {
      return null;
    }
  }

  async getColumns(): Promise<IBoardColumn[]> {
    const { fieldId, optionIds } = await this.ensureProjectCache();
    return BOARD_COLUMNS.map((name) => ({ id: optionIds.get(name) ?? fieldId, name }));
  }

  async createIssue(input: ICreateIssueInput): Promise<IBoardIssue> {
    const repo = await this.getRepo();
    const { projectId, fieldId, optionIds } = await this.ensureProjectCache();

    const issueArgs = ['issue', 'create', '--title', input.title, '--body', input.body, '--repo', repo];
    if (input.labels && input.labels.length > 0) {
      issueArgs.push('--label', input.labels.join(','));
    }

    const { stdout: issueUrlRaw } = await execFileAsync('gh', issueArgs, { cwd: this.cwd, encoding: 'utf-8' });
    const issueUrl = issueUrlRaw.trim();
    const issueNumber = parseInt(issueUrl.split('/').pop() ?? '', 10);
    if (!issueNumber) throw new Error(`Failed to parse issue number from URL: ${issueUrl}`);

    const [owner, repoName] = repo.split('/');
    const { stdout: nodeIdRaw } = await execFileAsync(
      'gh',
      ['api', `repos/${owner}/${repoName}/issues/${issueNumber}`, '--jq', '.node_id'],
      { cwd: this.cwd, encoding: 'utf-8' },
    );
    const issueJson = { number: issueNumber, id: nodeIdRaw.trim(), url: issueUrl };

    const addData = await graphql<IAddItemData>(
      `mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }`,
      { projectId, contentId: issueJson.id },
      this.cwd,
    );

    const itemId = addData.addProjectV2ItemById.item.id;
    const targetColumn = input.column ?? 'Draft';
    const optionId = optionIds.get(targetColumn);
    if (optionId) await this.setItemStatus(projectId, itemId, fieldId, optionId);

    const fullIssue = await this.getIssue(issueJson.number);
    if (fullIssue) return { ...fullIssue, column: targetColumn };

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
        ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,title,body,url,id,labels,assignees'],
        { cwd: this.cwd, encoding: 'utf-8' },
      );
      rawIssue = JSON.parse(output) as IRawIssue;
    } catch {
      return null;
    }

    let column: BoardColumnName | null = null;
    try {
      const match = (await this.getAllIssues()).find((i) => i.number === issueNumber);
      if (match) column = match.column;
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
    return (await this.getAllIssues()).filter((issue) => issue.column === column);
  }

  async getAllIssues(): Promise<IBoardIssue[]> {
    const repo = await this.getRepo();
    const { projectId } = await this.ensureProjectCache();
    const results: IBoardIssue[] = [];
    for (const item of await this.fetchAllProjectItems(projectId)) {
      const parsed = this.parseItem(item, repo);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  async moveIssue(issueNumber: number, targetColumn: BoardColumnName): Promise<void> {
    const repo = await this.getRepo();
    const { projectId, fieldId, optionIds } = await this.ensureProjectCache();

    const itemNode = (await this.fetchAllProjectItems(projectId)).find(
      (n) => n.content?.number === issueNumber && this.isCurrentRepoItem(n.content, repo),
    );
    if (!itemNode) throw new Error(`Issue #${issueNumber} not found on the project board.`);

    const optionId = optionIds.get(targetColumn);
    if (!optionId) throw new Error(`Column "${targetColumn}" not found on the project board.`);

    await this.setItemStatus(projectId, itemNode.id, fieldId, optionId);
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
