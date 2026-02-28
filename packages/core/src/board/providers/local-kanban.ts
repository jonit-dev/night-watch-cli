/**
 * Local Kanban Board provider backed by SQLite.
 * Implements IBoardProvider by delegating all persistence to IKanbanIssueRepository.
 */

import {
  BOARD_COLUMNS,
  BoardColumnName,
  IBoardColumn,
  IBoardInfo,
  IBoardIssue,
  IBoardProvider,
  ICreateIssueInput,
} from '@/board/types.js';
import { DEFAULT_LOCAL_BOARD_INFO } from '@/constants.js';
import { IKanbanIssue, IKanbanIssueRepository } from '@/storage/repositories/interfaces.js';

export class LocalKanbanProvider implements IBoardProvider {
  constructor(private readonly repo: IKanbanIssueRepository) {}

  async setupBoard(title: string): Promise<IBoardInfo> {
    return { ...DEFAULT_LOCAL_BOARD_INFO, title };
  }

  async getBoard(): Promise<IBoardInfo | null> {
    return DEFAULT_LOCAL_BOARD_INFO;
  }

  async getColumns(): Promise<IBoardColumn[]> {
    return BOARD_COLUMNS.map((name, i) => ({ id: String(i), name }));
  }

  async createIssue(input: ICreateIssueInput): Promise<IBoardIssue> {
    const row = this.repo.create({
      title: input.title,
      body: input.body,
      columnName: input.column ?? 'Draft',
      labels: input.labels,
    });
    return toIBoardIssue(row);
  }

  async getIssue(issueNumber: number): Promise<IBoardIssue | null> {
    const row = this.repo.getByNumber(issueNumber);
    return row ? toIBoardIssue(row) : null;
  }

  async getIssuesByColumn(column: BoardColumnName): Promise<IBoardIssue[]> {
    return this.repo.getByColumn(column).map(toIBoardIssue);
  }

  async getAllIssues(): Promise<IBoardIssue[]> {
    return this.repo.getAll().map(toIBoardIssue);
  }

  async moveIssue(issueNumber: number, targetColumn: BoardColumnName): Promise<void> {
    this.repo.move(issueNumber, targetColumn);
  }

  async closeIssue(issueNumber: number): Promise<void> {
    this.repo.close(issueNumber);
  }

  async commentOnIssue(issueNumber: number, body: string): Promise<void> {
    this.repo.addComment(issueNumber, body);
  }
}

function toIBoardIssue(row: IKanbanIssue): IBoardIssue {
  return {
    id: String(row.number),
    number: row.number,
    title: row.title,
    body: row.body,
    url: `local://kanban/${row.number}`,
    column: row.columnName,
    labels: row.labels,
    assignees: row.assignees,
  };
}
