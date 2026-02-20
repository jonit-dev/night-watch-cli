/**
 * SQLite implementation of IExecutionHistoryRepository.
 * Persists execution records in the `execution_history` table.
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
let SqliteExecutionHistoryRepository = class SqliteExecutionHistoryRepository {
    _db;
    constructor(db) {
        this._db = db;
    }
    getRecords(projectPath, prdFile) {
        const rows = this._db
            .prepare(`SELECT timestamp, outcome, exit_code, attempt
         FROM execution_history
         WHERE project_path = ? AND prd_file = ?
         ORDER BY timestamp DESC, id DESC`)
            .all(projectPath, prdFile);
        return rows.map((row) => ({
            timestamp: row.timestamp,
            outcome: row.outcome,
            exitCode: row.exit_code,
            attempt: row.attempt,
        }));
    }
    addRecord(projectPath, prdFile, record) {
        this._db
            .prepare(`INSERT INTO execution_history
           (project_path, prd_file, timestamp, outcome, exit_code, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run(projectPath, prdFile, record.timestamp, record.outcome, record.exitCode, record.attempt);
    }
    getAllHistory() {
        const rows = this._db
            .prepare(`SELECT project_path, prd_file, timestamp, outcome, exit_code, attempt
         FROM execution_history
         ORDER BY project_path, prd_file, timestamp ASC, id ASC`)
            .all();
        const history = {};
        for (const row of rows) {
            if (!history[row.project_path]) {
                history[row.project_path] = {};
            }
            if (!history[row.project_path][row.prd_file]) {
                history[row.project_path][row.prd_file] = { records: [] };
            }
            history[row.project_path][row.prd_file].records.push({
                timestamp: row.timestamp,
                outcome: row.outcome,
                exitCode: row.exit_code,
                attempt: row.attempt,
            });
        }
        return history;
    }
    replaceAll(history) {
        const replaceAll = this._db.transaction(() => {
            this._db.prepare("DELETE FROM execution_history").run();
            const insert = this._db.prepare(`INSERT INTO execution_history
           (project_path, prd_file, timestamp, outcome, exit_code, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`);
            for (const [projectPath, prdMap] of Object.entries(history)) {
                for (const [prdFile, prdHistory] of Object.entries(prdMap)) {
                    for (const record of prdHistory.records) {
                        insert.run(projectPath, prdFile, record.timestamp, record.outcome, record.exitCode, record.attempt);
                    }
                }
            }
        });
        replaceAll();
    }
    trimRecords(projectPath, prdFile, maxCount) {
        // Count current records for this project/prd pair
        const countRow = this._db
            .prepare(`SELECT COUNT(*) as count
         FROM execution_history
         WHERE project_path = ? AND prd_file = ?`)
            .get(projectPath, prdFile);
        const total = countRow?.count ?? 0;
        if (total <= maxCount) {
            return;
        }
        const deleteCount = total - maxCount;
        // Delete the oldest records (lowest timestamp ids)
        this._db
            .prepare(`DELETE FROM execution_history
         WHERE id IN (
           SELECT id FROM execution_history
           WHERE project_path = ? AND prd_file = ?
           ORDER BY timestamp ASC, id ASC
           LIMIT ?
         )`)
            .run(projectPath, prdFile, deleteCount);
    }
};
SqliteExecutionHistoryRepository = __decorate([
    injectable(),
    __param(0, inject('Database')),
    __metadata("design:paramtypes", [Object])
], SqliteExecutionHistoryRepository);
export { SqliteExecutionHistoryRepository };
//# sourceMappingURL=execution-history.repository.js.map