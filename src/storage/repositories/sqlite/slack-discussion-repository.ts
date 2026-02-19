/**
 * SQLite implementation of ISlackDiscussionRepository.
 * Persists Slack discussion records in the `slack_discussions` table.
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  ConsensusResult,
  DiscussionStatus,
  ISlackDiscussion,
  TriggerType,
} from "../../../../shared/types.js";
import { ISlackDiscussionRepository } from "../interfaces.js";

interface ISlackDiscussionRow {
  id: string;
  project_path: string;
  trigger_type: string;
  trigger_ref: string;
  channel_id: string;
  thread_ts: string;
  status: string;
  round: number;
  participants_json: string;
  consensus_result: string | null;
  created_at: number;
  updated_at: number;
}

function rowToDiscussion(row: ISlackDiscussionRow): ISlackDiscussion {
  return {
    id: row.id,
    projectPath: row.project_path,
    triggerType: row.trigger_type as TriggerType,
    triggerRef: row.trigger_ref,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    status: row.status as DiscussionStatus,
    round: row.round,
    participants: JSON.parse(row.participants_json || '[]'),
    consensusResult: row.consensus_result as ConsensusResult | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteSlackDiscussionRepository implements ISlackDiscussionRepository {
  private readonly _db: Database.Database;

  constructor(db: Database.Database) {
    this._db = db;
  }

  getById(id: string): ISlackDiscussion | null {
    const row = this._db
      .prepare<[string], ISlackDiscussionRow>('SELECT * FROM slack_discussions WHERE id = ?')
      .get(id);
    return row ? rowToDiscussion(row) : null;
  }

  getActive(projectPath: string): ISlackDiscussion[] {
    const rows = projectPath
      ? this._db
        .prepare<[string], ISlackDiscussionRow>(
          "SELECT * FROM slack_discussions WHERE project_path = ? AND status = 'active' ORDER BY created_at DESC"
        )
        .all(projectPath)
      : this._db
        .prepare<[], ISlackDiscussionRow>(
          "SELECT * FROM slack_discussions WHERE status = 'active' ORDER BY created_at DESC"
        )
        .all();
    return rows.map(rowToDiscussion);
  }

  create(discussion: Omit<ISlackDiscussion, 'id' | 'createdAt' | 'updatedAt'>): ISlackDiscussion {
    const id = randomUUID();
    const now = Date.now();

    this._db
      .prepare<[string, string, string, string, string, string, string, number, string, string | null, number, number]>(
        `INSERT INTO slack_discussions
         (id, project_path, trigger_type, trigger_ref, channel_id, thread_ts, status, round, participants_json, consensus_result, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        discussion.projectPath,
        discussion.triggerType,
        discussion.triggerRef,
        discussion.channelId,
        discussion.threadTs,
        discussion.status,
        discussion.round,
        JSON.stringify(discussion.participants),
        discussion.consensusResult ?? null,
        now,
        now,
      );

    return this.getById(id)!;
  }

  updateStatus(id: string, status: DiscussionStatus, consensusResult?: ConsensusResult): void {
    this._db
      .prepare<[string, string | null, number, string]>(
        'UPDATE slack_discussions SET status = ?, consensus_result = ?, updated_at = ? WHERE id = ?'
      )
      .run(status, consensusResult ?? null, Date.now(), id);
  }

  updateRound(id: string, round: number): void {
    this._db
      .prepare<[number, number, string]>(
        'UPDATE slack_discussions SET round = ?, updated_at = ? WHERE id = ?'
      )
      .run(round, Date.now(), id);
  }

  addParticipant(id: string, agentId: string): void {
    const discussion = this.getById(id);
    if (!discussion) return;
    if (!discussion.participants.includes(agentId)) {
      discussion.participants.push(agentId);
      this._db
        .prepare<[string, number, string]>(
          'UPDATE slack_discussions SET participants_json = ?, updated_at = ? WHERE id = ?'
        )
        .run(JSON.stringify(discussion.participants), Date.now(), id);
    }
  }

  close(id: string): void {
    this.updateStatus(id, 'closed');
  }
}
