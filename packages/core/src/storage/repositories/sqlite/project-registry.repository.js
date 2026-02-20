/**
 * SQLite implementation of IProjectRegistryRepository.
 * Persists project registry entries in the `projects` table.
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
import { inject, injectable } from "tsyringe";
let SqliteProjectRegistryRepository = class SqliteProjectRegistryRepository {
    _db;
    constructor(db) {
        this._db = db;
    }
    getAll() {
        const rows = this._db
            .prepare("SELECT name, path, slack_channel_id FROM projects ORDER BY name")
            .all();
        return rows.map((row) => ({
            name: row.name,
            path: row.path,
            ...(row.slack_channel_id ? { slackChannelId: row.slack_channel_id } : {}),
        }));
    }
    upsert(entry) {
        const createdAt = Math.floor(Date.now() / 1000);
        this._db
            .prepare(`INSERT INTO projects (name, path, created_at, slack_channel_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name, slack_channel_id = COALESCE(excluded.slack_channel_id, slack_channel_id)`)
            .run(entry.name, entry.path, createdAt, entry.slackChannelId ?? null);
    }
    remove(projectPath) {
        const result = this._db
            .prepare("DELETE FROM projects WHERE path = ?")
            .run(projectPath);
        return result.changes > 0;
    }
    clear() {
        this._db.prepare("DELETE FROM projects").run();
    }
    updateSlackChannel(path, channelId) {
        this._db
            .prepare(`UPDATE projects SET slack_channel_id = ? WHERE path = ?`)
            .run(channelId || null, path);
    }
};
SqliteProjectRegistryRepository = __decorate([
    injectable(),
    __param(0, inject('Database')),
    __metadata("design:paramtypes", [Object])
], SqliteProjectRegistryRepository);
export { SqliteProjectRegistryRepository };
//# sourceMappingURL=project-registry.repository.js.map