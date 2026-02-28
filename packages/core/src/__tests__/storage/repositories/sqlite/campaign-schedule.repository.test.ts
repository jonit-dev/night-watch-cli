/**
 * Tests for SqliteCampaignScheduleRepository
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

import { runMigrations } from '../../../../storage/sqlite/migrations.js';
import { SqliteCampaignScheduleRepository } from '../../../../storage/repositories/sqlite/campaign-schedule.repository.js';
import { ICampaignSchedule, IBudgetSchedule } from '../../../../campaign/types.js';

let tmpDir: string;
let db: Database.Database;
let repository: SqliteCampaignScheduleRepository;

const createTestSchedule = (overrides: Partial<ICampaignSchedule> = {}) => ({
  campaignId: 'campaign-123',
  adAccountId: 'act-456',
  campaignName: 'Test Campaign',
  startDate: Math.floor(Date.now() / 1000),
  endDate: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days later
  budgetSchedule: null,
  status: 'scheduled' as const,
  ...overrides,
});

const sampleBudgetSchedule: IBudgetSchedule = {
  baseAmount: 10000,
  schedules: [{ date: Math.floor(Date.now() / 1000), amount: 15000, note: 'Weekend boost' }],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-campaign-schedule-test-'));
  db = new Database(path.join(tmpDir, 'test.db'));
  runMigrations(db);
  repository = new SqliteCampaignScheduleRepository(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SqliteCampaignScheduleRepository', () => {
  describe('create', () => {
    it('creates a new campaign schedule', () => {
      const input = createTestSchedule();
      const result = repository.create(input);

      expect(result.id).toBeGreaterThan(0);
      expect(result.campaignId).toBe(input.campaignId);
      expect(result.adAccountId).toBe(input.adAccountId);
      expect(result.campaignName).toBe(input.campaignName);
      expect(result.startDate).toBe(input.startDate);
      expect(result.endDate).toBe(input.endDate);
      expect(result.budgetSchedule).toBeNull();
      expect(result.status).toBe(input.status);
      expect(result.createdAt).toBeGreaterThan(0);
      expect(result.updatedAt).toBeGreaterThan(0);
    });

    it('creates a campaign schedule with budget schedule', () => {
      const input = createTestSchedule({ budgetSchedule: sampleBudgetSchedule });
      const result = repository.create(input);

      expect(result.budgetSchedule).toEqual(sampleBudgetSchedule);
    });

    it('sets createdAt and updatedAt to the same value on creation', () => {
      const input = createTestSchedule();
      const result = repository.create(input);

      expect(result.createdAt).toBe(result.updatedAt);
    });
  });

  describe('getAll', () => {
    it('returns an empty array when no schedules exist', () => {
      const result = repository.getAll();
      expect(result).toEqual([]);
    });

    it('returns all campaign schedules ordered by start_date', () => {
      const now = Math.floor(Date.now() / 1000);
      repository.create(createTestSchedule({ campaignId: 'c3', startDate: now + 86400 * 2 }));
      repository.create(createTestSchedule({ campaignId: 'c1', startDate: now }));
      repository.create(createTestSchedule({ campaignId: 'c2', startDate: now + 86400 }));

      const result = repository.getAll();

      expect(result).toHaveLength(3);
      expect(result[0].campaignId).toBe('c1');
      expect(result[1].campaignId).toBe('c2');
      expect(result[2].campaignId).toBe('c3');
    });
  });

  describe('getById', () => {
    it('returns null when schedule does not exist', () => {
      const result = repository.getById(999);
      expect(result).toBeNull();
    });

    it('returns the schedule by id', () => {
      const created = repository.create(createTestSchedule());
      const result = repository.getById(created.id);

      expect(result).toEqual(created);
    });
  });

  describe('getByCampaignId', () => {
    it('returns null when campaign has no schedule', () => {
      const result = repository.getByCampaignId('non-existent');
      expect(result).toBeNull();
    });

    it('returns the schedule by campaign id', () => {
      const created = repository.create(createTestSchedule({ campaignId: 'my-campaign' }));
      const result = repository.getByCampaignId('my-campaign');

      expect(result).toEqual(created);
    });
  });

  describe('getByDateRange', () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 86400;

    beforeEach(() => {
      // Create schedules with different date ranges
      repository.create(
        createTestSchedule({
          campaignId: 'past',
          startDate: now - day * 10,
          endDate: now - day * 5,
        }),
      );
      repository.create(
        createTestSchedule({
          campaignId: 'current',
          startDate: now - day,
          endDate: now + day * 5,
        }),
      );
      repository.create(
        createTestSchedule({
          campaignId: 'future',
          startDate: now + day * 10,
          endDate: now + day * 15,
        }),
      );
      repository.create(
        createTestSchedule({
          campaignId: 'overlapping',
          startDate: now + day * 2,
          endDate: now + day * 8,
        }),
      );
    });

    it('returns schedules that overlap with the given range', () => {
      const result = repository.getByDateRange(now, now + day * 3);

      // Should include 'current' (spans the entire range) and 'overlapping' (starts within range)
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.campaignId)).toEqual(
        expect.arrayContaining(['current', 'overlapping']),
      );
    });

    it('returns empty array when no schedules overlap', () => {
      const result = repository.getByDateRange(now - day * 20, now - day * 15);
      expect(result).toEqual([]);
    });

    it('includes schedules that start exactly on range end', () => {
      const result = repository.getByDateRange(now + day * 10, now + day * 12);
      expect(result).toHaveLength(1);
      expect(result[0].campaignId).toBe('future');
    });

    it('includes schedules that end exactly on range start', () => {
      const result = repository.getByDateRange(now - day * 5, now - day * 3);
      expect(result).toHaveLength(1);
      expect(result[0].campaignId).toBe('past');
    });
  });

  describe('update', () => {
    it('returns null when schedule does not exist', () => {
      const result = repository.update(999, { campaignName: 'Updated' });
      expect(result).toBeNull();
    });

    it('updates campaign name', () => {
      const created = repository.create(createTestSchedule());
      const result = repository.update(created.id, { campaignName: 'Updated Name' });

      expect(result).not.toBeNull();
      expect(result!.campaignName).toBe('Updated Name');
      expect(result!.updatedAt).toBeGreaterThan(created.updatedAt);
    });

    it('updates status', () => {
      const created = repository.create(createTestSchedule());
      const result = repository.update(created.id, { status: 'active' });

      expect(result!.status).toBe('active');
    });

    it('updates budget schedule', () => {
      const created = repository.create(createTestSchedule());
      const result = repository.update(created.id, { budgetSchedule: sampleBudgetSchedule });

      expect(result!.budgetSchedule).toEqual(sampleBudgetSchedule);
    });

    it('clears budget schedule when set to null', () => {
      const created = repository.create(
        createTestSchedule({ budgetSchedule: sampleBudgetSchedule }),
      );
      const result = repository.update(created.id, { budgetSchedule: null });

      expect(result!.budgetSchedule).toBeNull();
    });

    it('preserves createdAt on update', () => {
      const created = repository.create(createTestSchedule());
      const result = repository.update(created.id, { campaignName: 'Updated' });

      expect(result!.createdAt).toBe(created.createdAt);
    });

    it('preserves unmodified fields', () => {
      const created = repository.create(createTestSchedule());
      const result = repository.update(created.id, { campaignName: 'Updated' });

      expect(result!.campaignId).toBe(created.campaignId);
      expect(result!.adAccountId).toBe(created.adAccountId);
      expect(result!.startDate).toBe(created.startDate);
      expect(result!.endDate).toBe(created.endDate);
    });
  });

  describe('delete', () => {
    it('returns false when schedule does not exist', () => {
      const result = repository.delete(999);
      expect(result).toBe(false);
    });

    it('deletes an existing schedule and returns true', () => {
      const created = repository.create(createTestSchedule());
      const result = repository.delete(created.id);

      expect(result).toBe(true);
      expect(repository.getById(created.id)).toBeNull();
    });
  });
});
