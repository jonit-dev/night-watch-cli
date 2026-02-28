/**
 * SQLite implementation of ICampaignScheduleRepository.
 * Persists campaign schedule entities with JSON-serialized budget schedules.
 */

import Database from 'better-sqlite3';
import { inject, injectable } from 'tsyringe';
import {
  CreateCampaignScheduleInput,
  IBudgetSchedule,
  ICampaignSchedule,
  UpdateCampaignScheduleInput,
} from '@/campaign/types.js';
import { ICampaignScheduleRepository } from '../interfaces.js';

interface ICampaignScheduleRow {
  id: number;
  campaign_id: string;
  ad_account_id: string;
  campaign_name: string;
  start_date: number;
  end_date: number;
  budget_schedule_json: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

function parseBudgetSchedule(json: string | null): IBudgetSchedule | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as IBudgetSchedule;
  } catch {
    return null;
  }
}

function rowToSchedule(row: ICampaignScheduleRow): ICampaignSchedule {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    adAccountId: row.ad_account_id,
    campaignName: row.campaign_name,
    startDate: row.start_date,
    endDate: row.end_date,
    budgetSchedule: parseBudgetSchedule(row.budget_schedule_json),
    status: row.status as ICampaignSchedule['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteCampaignScheduleRepository implements ICampaignScheduleRepository {
  private readonly db: Database.Database;

  constructor(@inject('Database') db: Database.Database) {
    this.db = db;
  }

  getAll(): ICampaignSchedule[] {
    const rows = this.db
      .prepare<[], ICampaignScheduleRow>('SELECT * FROM campaign_schedules ORDER BY start_date ASC')
      .all();
    return rows.map(rowToSchedule);
  }

  getById(id: number): ICampaignSchedule | null {
    const row = this.db
      .prepare<[number], ICampaignScheduleRow>('SELECT * FROM campaign_schedules WHERE id = ?')
      .get(id);
    return row ? rowToSchedule(row) : null;
  }

  getByCampaignId(campaignId: string): ICampaignSchedule | null {
    const row = this.db
      .prepare<
        [string],
        ICampaignScheduleRow
      >('SELECT * FROM campaign_schedules WHERE campaign_id = ?')
      .get(campaignId);
    return row ? rowToSchedule(row) : null;
  }

  getByDateRange(start: number, end: number): ICampaignSchedule[] {
    // Find schedules that overlap with the given range
    // A schedule overlaps if: schedule.start_date <= end AND schedule.end_date >= start
    const rows = this.db
      .prepare<[number, number], ICampaignScheduleRow>(
        `SELECT * FROM campaign_schedules
         WHERE start_date <= ? AND end_date >= ?
         ORDER BY start_date ASC`,
      )
      .all(end, start);
    return rows.map(rowToSchedule);
  }

  create(schedule: CreateCampaignScheduleInput): ICampaignSchedule {
    const now = Date.now();
    const budgetScheduleJson = schedule.budgetSchedule
      ? JSON.stringify(schedule.budgetSchedule)
      : null;

    const result = this.db
      .prepare<
        [string, string, string, number, number, string | null, string, number, number],
        { lastInsertRowid: bigint }
      >(
        `INSERT INTO campaign_schedules
         (campaign_id, ad_account_id, campaign_name, start_date, end_date, budget_schedule_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        schedule.campaignId,
        schedule.adAccountId,
        schedule.campaignName,
        schedule.startDate,
        schedule.endDate,
        budgetScheduleJson,
        schedule.status,
        now,
        now,
      );

    const id = Number(result.lastInsertRowid);
    return this.getById(id)!;
  }

  update(id: number, updates: UpdateCampaignScheduleInput): ICampaignSchedule | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = Date.now();
    const mergedSchedule: ICampaignSchedule = {
      ...existing,
      ...updates,
      id,
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    const budgetScheduleJson = mergedSchedule.budgetSchedule
      ? JSON.stringify(mergedSchedule.budgetSchedule)
      : null;

    this.db
      .prepare<
        [string, string, string, number, number, string | null, string, number, number],
        void
      >(
        `UPDATE campaign_schedules
         SET campaign_id = ?, ad_account_id = ?, campaign_name = ?,
             start_date = ?, end_date = ?, budget_schedule_json = ?,
             status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        mergedSchedule.campaignId,
        mergedSchedule.adAccountId,
        mergedSchedule.campaignName,
        mergedSchedule.startDate,
        mergedSchedule.endDate,
        budgetScheduleJson,
        mergedSchedule.status,
        mergedSchedule.updatedAt,
        id,
      );

    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare<[number], { changes: bigint }>('DELETE FROM campaign_schedules WHERE id = ?')
      .run(id);
    return Number(result.changes) > 0;
  }
}
