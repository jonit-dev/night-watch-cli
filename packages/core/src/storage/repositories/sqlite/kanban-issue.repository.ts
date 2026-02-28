/**
 * SQLite implementation of IKanbanIssueRepository.
 * Persists local kanban board issues with JSON-serialized labels and assignees.
 */

import Database from 'better-sqlite3';
import { inject, injectable } from 'tsyringe';

import { BoardColumnName } from '@/board/types.js';

import { ICreateKanbanIssueInput, IKanbanIssue, IKanbanIssueRepository } from '../interfaces.js';

interface IKanbanIssueRow {
  number: number;
  title: string;
  body: string;
  column_name: string;
  labels_json: string;
  assignees_json: string;
  is_closed: number;
  created_at: number;
  updated_at: number;
}

function rowToIssue(row: IKanbanIssueRow): IKanbanIssue {
  return {
    number: row.number,
    title: row.title,
    body: row.body,
    columnName: row.column_name as BoardColumnName,
    labels: JSON.parse(row.labels_json) as string[],
    assignees: JSON.parse(row.assignees_json) as string[],
    isClosed: row.is_closed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteKanbanIssueRepository implements IKanbanIssueRepository {
  private readonly db: Database.Database;

  constructor(@inject('Database') db: Database.Database) {
    this.db = db;
  }

  create(input: ICreateKanbanIssueInput): IKanbanIssue {
    const now = Date.now();
    const columnName = input.columnName ?? 'Draft';
    const labels = input.labels ?? [];

    const result = this.db
      .prepare<[string, string, string, string, string, number, number]>(
        `INSERT INTO kanban_issues (title, body, column_name, labels_json, assignees_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title,
        input.body ?? '',
        columnName,
        JSON.stringify(labels),
        JSON.stringify([]),
        now,
        now,
      );

    return this.getByNumber(Number(result.lastInsertRowid))!;
  }

  getByNumber(number: number): IKanbanIssue | null {
    const row = this.db
      .prepare<[number], IKanbanIssueRow>('SELECT * FROM kanban_issues WHERE number = ?')
      .get(number);
    return row ? rowToIssue(row) : null;
  }

  getAll(includeClosed?: boolean): IKanbanIssue[] {
    if (includeClosed) {
      const rows = this.db
        .prepare<[], IKanbanIssueRow>('SELECT * FROM kanban_issues ORDER BY created_at ASC')
        .all();
      return rows.map(rowToIssue);
    }

    const rows = this.db
      .prepare<
        [],
        IKanbanIssueRow
      >('SELECT * FROM kanban_issues WHERE is_closed = 0 ORDER BY created_at ASC')
      .all();
    return rows.map(rowToIssue);
  }

  getByColumn(column: BoardColumnName): IKanbanIssue[] {
    const rows = this.db
      .prepare<
        [string],
        IKanbanIssueRow
      >('SELECT * FROM kanban_issues WHERE column_name = ? AND is_closed = 0 ORDER BY created_at ASC')
      .all(column);
    return rows.map(rowToIssue);
  }

  move(number: number, targetColumn: BoardColumnName): void {
    const now = Date.now();
    this.db
      .prepare<
        [string, number, number]
      >('UPDATE kanban_issues SET column_name = ?, updated_at = ? WHERE number = ?')
      .run(targetColumn, now, number);
  }

  close(number: number): void {
    const now = Date.now();
    this.db
      .prepare<
        [number, number]
      >('UPDATE kanban_issues SET is_closed = 1, updated_at = ? WHERE number = ?')
      .run(now, number);
  }

  addComment(number: number, body: string): void {
    const now = Date.now();
    this.db
      .prepare<
        [number, string, number]
      >('INSERT INTO kanban_comments (issue_number, body, created_at) VALUES (?, ?, ?)')
      .run(number, body, now);
  }
}
