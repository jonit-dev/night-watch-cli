/**
 * SQLite implementation of IPrdStateRepository.
 * Persists PRD state entries in the `prd_states` table.
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
let SqlitePrdStateRepository = class SqlitePrdStateRepository {
    _db;
    constructor(db) {
        this._db = db;
    }
    get(projectPath, prdName) {
        const row = this._db
            .prepare(`SELECT status, branch, timestamp
         FROM prd_states
         WHERE project_path = ? AND prd_name = ?`)
            .get(projectPath, prdName);
        if (!row) {
            return null;
        }
        return {
            status: row.status,
            branch: row.branch,
            timestamp: row.timestamp,
        };
    }
    getAll(projectPath) {
        const rows = this._db
            .prepare(`SELECT prd_name, status, branch, timestamp
         FROM prd_states
         WHERE project_path = ?`)
            .all(projectPath);
        const result = {};
        for (const row of rows) {
            result[row.prd_name] = {
                status: row.status,
                branch: row.branch,
                timestamp: row.timestamp,
            };
        }
        return result;
    }
    readAll() {
        const rows = this._db
            .prepare("SELECT project_path, prd_name, status, branch, timestamp FROM prd_states")
            .all();
        const result = {};
        for (const row of rows) {
            if (!result[row.project_path]) {
                result[row.project_path] = {};
            }
            result[row.project_path][row.prd_name] = {
                status: row.status,
                branch: row.branch,
                timestamp: row.timestamp,
            };
        }
        return result;
    }
    set(projectPath, prdName, entry) {
        this._db
            .prepare(`INSERT INTO prd_states (project_path, prd_name, status, branch, timestamp)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_path, prd_name)
         DO UPDATE SET status = excluded.status,
                       branch = excluded.branch,
                       timestamp = excluded.timestamp`)
            .run(projectPath, prdName, entry.status, entry.branch, entry.timestamp);
    }
    delete(projectPath, prdName) {
        this._db
            .prepare(`DELETE FROM prd_states WHERE project_path = ? AND prd_name = ?`)
            .run(projectPath, prdName);
    }
};
SqlitePrdStateRepository = __decorate([
    injectable(),
    __param(0, inject('Database')),
    __metadata("design:paramtypes", [Object])
], SqlitePrdStateRepository);
export { SqlitePrdStateRepository };
//# sourceMappingURL=prd-state.repository.js.map