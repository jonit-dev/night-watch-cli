/**
 * SQLite implementation of ISlackDiscussionRepository.
 * Persists Slack discussion records in the `slack_discussions` table.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import 'reflect-metadata';
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { inject, injectable } from "tsyringe";
function rowToDiscussion(row) {
    return {
        id: row.id,
        projectPath: row.project_path,
        triggerType: row.trigger_type,
        triggerRef: row.trigger_ref,
        channelId: row.channel_id,
        threadTs: row.thread_ts,
        status: row.status,
        round: row.round,
        participants: JSON.parse(row.participants_json || '[]'),
        consensusResult: row.consensus_result,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
let SqliteSlackDiscussionRepository = class SqliteSlackDiscussionRepository {
    _db;
    constructor(db) {
        this._db = db;
    }
    getById(id) {
        const row = this._db
            .prepare('SELECT * FROM slack_discussions WHERE id = ?')
            .get(id);
        return row ? rowToDiscussion(row) : null;
    }
    getActive(projectPath) {
        const rows = projectPath
            ? this._db
                .prepare("SELECT * FROM slack_discussions WHERE project_path = ? AND status = 'active' ORDER BY created_at DESC")
                .all(projectPath)
            : this._db
                .prepare("SELECT * FROM slack_discussions WHERE status = 'active' ORDER BY created_at DESC")
                .all();
        return rows.map(rowToDiscussion);
    }
    getLatestByTrigger(projectPath, triggerType, triggerRef) {
        const row = this._db
            .prepare(`SELECT *
         FROM slack_discussions
         WHERE project_path = ? AND trigger_type = ? AND trigger_ref = ?
         ORDER BY created_at DESC
         LIMIT 1`)
            .get(projectPath, triggerType, triggerRef);
        return row ? rowToDiscussion(row) : null;
    }
    create(discussion) {
        const id = randomUUID();
        const now = Date.now();
        this._db
            .prepare(`INSERT INTO slack_discussions
         (id, project_path, trigger_type, trigger_ref, channel_id, thread_ts, status, round, participants_json, consensus_result, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, discussion.projectPath, discussion.triggerType, discussion.triggerRef, discussion.channelId, discussion.threadTs, discussion.status, discussion.round, JSON.stringify(discussion.participants), discussion.consensusResult ?? null, now, now);
        return this.getById(id);
    }
    updateStatus(id, status, consensusResult) {
        this._db
            .prepare('UPDATE slack_discussions SET status = ?, consensus_result = ?, updated_at = ? WHERE id = ?')
            .run(status, consensusResult ?? null, Date.now(), id);
    }
    updateRound(id, round) {
        this._db
            .prepare('UPDATE slack_discussions SET round = ?, updated_at = ? WHERE id = ?')
            .run(round, Date.now(), id);
    }
    addParticipant(id, agentId) {
        const discussion = this.getById(id);
        if (!discussion)
            return;
        if (!discussion.participants.includes(agentId)) {
            discussion.participants.push(agentId);
            this._db
                .prepare('UPDATE slack_discussions SET participants_json = ?, updated_at = ? WHERE id = ?')
                .run(JSON.stringify(discussion.participants), Date.now(), id);
        }
    }
    close(id) {
        this.updateStatus(id, 'closed');
    }
};
SqliteSlackDiscussionRepository = __decorate([
    injectable(),
    __param(0, inject('Database')),
    __metadata("design:paramtypes", [Object])
], SqliteSlackDiscussionRepository);
export { SqliteSlackDiscussionRepository };
//# sourceMappingURL=slack-discussion.repository.js.map