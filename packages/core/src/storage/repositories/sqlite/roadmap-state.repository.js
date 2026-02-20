/**
 * SQLite implementation of IRoadmapStateRepository.
 * Persists roadmap state in the `roadmap_states` table, keyed by prd_dir.
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
let SqliteRoadmapStateRepository = class SqliteRoadmapStateRepository {
    _db;
    constructor(db) {
        this._db = db;
    }
    load(prdDir) {
        const row = this._db
            .prepare(`SELECT version, last_scan, items_json
         FROM roadmap_states
         WHERE prd_dir = ?`)
            .get(prdDir);
        if (!row) {
            return null;
        }
        let items = {};
        try {
            const parsed = JSON.parse(row.items_json);
            if (typeof parsed === "object" && parsed !== null) {
                items = parsed;
            }
        }
        catch {
            items = {};
        }
        return {
            version: row.version,
            lastScan: row.last_scan,
            items,
        };
    }
    save(prdDir, state) {
        const itemsJson = JSON.stringify(state.items);
        this._db
            .prepare(`INSERT INTO roadmap_states (prd_dir, version, last_scan, items_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(prd_dir)
         DO UPDATE SET version    = excluded.version,
                       last_scan  = excluded.last_scan,
                       items_json = excluded.items_json`)
            .run(prdDir, state.version, state.lastScan, itemsJson);
    }
};
SqliteRoadmapStateRepository = __decorate([
    injectable(),
    __param(0, inject('Database')),
    __metadata("design:paramtypes", [Object])
], SqliteRoadmapStateRepository);
export { SqliteRoadmapStateRepository };
//# sourceMappingURL=roadmap-state.repository.js.map