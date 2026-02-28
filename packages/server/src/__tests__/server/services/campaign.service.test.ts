/**
 * Tests for CampaignService.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { container } from 'tsyringe';

import {
  closeDb,
  resetRepositories,
  setMetaAdsProxy,
  resetMetaAdsProxy,
  type IMetaAdsProxy,
  type IAdAccount,
  type IMetaCampaign,
} from '@night-watch/core';

import { CampaignService, isValidCampaignStatus } from '../../../services/campaign.service.js';

// Mock Meta Ads data
const mockAdAccounts: IAdAccount[] = [
  {
    id: 'act_123456',
    name: 'Test Ad Account',
    currency: 'USD',
    timezone: 'America/New_York',
    amountSpent: '10000',
    accountStatus: 1,
  },
];

const mockCampaigns: IMetaCampaign[] = [
  {
    id: 'cmp_001',
    name: 'Test Campaign',
    status: 'ACTIVE',
    objective: 'CONVERSIONS',
    startTime: '2026-06-01T00:00:00Z',
    stopTime: '2026-06-30T23:59:59Z',
    dailyBudget: '10000',
    lifetimeBudget: null,
    accountId: 'act_123456',
  },
];

const createMockProxy = (): IMetaAdsProxy => ({
  getAdAccounts: vi.fn().mockResolvedValue({
    success: true,
    accounts: mockAdAccounts,
  }),
  getCampaigns: vi.fn().mockResolvedValue({
    success: true,
    campaigns: mockCampaigns,
    adAccountId: 'act_123456',
  }),
  getCampaign: vi.fn().mockImplementation((campaignId: string) => {
    const campaign = mockCampaigns.find((c) => c.id === campaignId);
    return Promise.resolve(campaign ?? null);
  }),
});

describe('CampaignService', () => {
  let service: CampaignService;
  let mockProxy: IMetaAdsProxy;
  let tempDir: string;
  let nightWatchHome: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-campaign-service-test-'));
    nightWatchHome = path.join(tempDir, '.night-watch-home');
    process.env.NIGHT_WATCH_HOME = nightWatchHome;

    container.reset();
    closeDb();
    resetRepositories();

    mockProxy = createMockProxy();
    setMetaAdsProxy(mockProxy);

    service = new CampaignService();
  });

  afterEach(() => {
    container.reset();
    closeDb();
    resetRepositories();
    resetMetaAdsProxy();
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getAdAccounts', () => {
    it('returns ad accounts from proxy', async () => {
      const result = await service.getAdAccounts();

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].id).toBe('act_123456');
    });

    it('calls proxy method', async () => {
      await service.getAdAccounts();

      expect(mockProxy.getAdAccounts).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCampaigns', () => {
    it('returns campaigns for an ad account', async () => {
      const result = await service.getCampaigns('act_123456');

      expect(result.success).toBe(true);
      expect(result.campaigns).toHaveLength(1);
      expect(result.campaigns[0].id).toBe('cmp_001');
    });

    it('passes ad account ID to proxy', async () => {
      await service.getCampaigns('act_123456');

      expect(mockProxy.getCampaigns).toHaveBeenCalledWith('act_123456');
    });
  });

  describe('getCampaign', () => {
    it('returns a single campaign', async () => {
      const result = await service.getCampaign('cmp_001');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('cmp_001');
      expect(result?.name).toBe('Test Campaign');
    });

    it('returns null for non-existent campaign', async () => {
      const result = await service.getCampaign('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getCampaignSchedules', () => {
    it('returns empty array initially', () => {
      const schedules = service.getCampaignSchedules();

      expect(schedules).toEqual([]);
    });

    it('returns created schedules', () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      const schedules = service.getCampaignSchedules();

      expect(schedules).toHaveLength(1);
      expect(schedules[0].campaignId).toBe('cmp_001');
    });
  });

  describe('getCampaignScheduleByCampaignId', () => {
    it('returns null for non-existent schedule', () => {
      const schedule = service.getCampaignScheduleByCampaignId('nonexistent');

      expect(schedule).toBeNull();
    });

    it('returns schedule by campaign ID', () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      const schedule = service.getCampaignScheduleByCampaignId('cmp_001');

      expect(schedule).not.toBeNull();
      expect(schedule?.campaignId).toBe('cmp_001');
    });
  });

  describe('createCampaignSchedule', () => {
    it('creates a new schedule', () => {
      const schedule = service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      expect(schedule).toHaveProperty('id');
      expect(schedule.campaignId).toBe('cmp_001');
      expect(schedule.adAccountId).toBe('act_123456');
      expect(schedule.campaignName).toBe('Test Campaign');
      expect(schedule.startDate).toBe(1000000);
      expect(schedule.endDate).toBe(2000000);
      expect(schedule.status).toBe('scheduled');
    });

    it('throws error if schedule already exists', () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      expect(() =>
        service.createCampaignSchedule({
          campaignId: 'cmp_001',
          adAccountId: 'act_123456',
          campaignName: 'Test Campaign',
          startDate: 1000000,
          endDate: 2000000,
        }),
      ).toThrow('Schedule already exists for campaign cmp_001');
    });

    it('accepts custom status', () => {
      const schedule = service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
        status: 'active',
      });

      expect(schedule.status).toBe('active');
    });

    it('accepts budget schedule', () => {
      const schedule = service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
        budgetSchedule: {
          baseAmount: 10000,
          schedules: [{ date: 1500000, amount: 15000 }],
        },
      });

      expect(schedule.budgetSchedule).not.toBeNull();
      expect(schedule.budgetSchedule?.baseAmount).toBe(10000);
      expect(schedule.budgetSchedule?.schedules).toHaveLength(1);
    });
  });

  describe('updateCampaignSchedule', () => {
    it('updates an existing schedule', () => {
      const created = service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      const updated = service.updateCampaignSchedule(created.id, {
        campaignName: 'Updated Campaign',
        status: 'active',
      });

      expect(updated).not.toBeNull();
      expect(updated?.campaignName).toBe('Updated Campaign');
      expect(updated?.status).toBe('active');
      expect(updated?.id).toBe(created.id);
    });

    it('returns null for non-existent schedule', () => {
      const updated = service.updateCampaignSchedule(9999, { status: 'active' });

      expect(updated).toBeNull();
    });
  });

  describe('upsertCampaignSchedule', () => {
    it('creates schedule if it does not exist', () => {
      const schedule = service.upsertCampaignSchedule('cmp_001', {
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      expect(schedule).toHaveProperty('id');
      expect(schedule.campaignId).toBe('cmp_001');
    });

    it('updates schedule if it exists', () => {
      const created = service.upsertCampaignSchedule('cmp_001', {
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      const updated = service.upsertCampaignSchedule('cmp_001', {
        adAccountId: 'act_123456',
        campaignName: 'Updated Campaign',
        startDate: 1000000,
        endDate: 2000000,
        status: 'active',
      });

      expect(updated.id).toBe(created.id);
      expect(updated.campaignName).toBe('Updated Campaign');
      expect(updated.status).toBe('active');
    });
  });

  describe('deleteCampaignSchedule', () => {
    it('deletes an existing schedule', () => {
      const created = service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      const deleted = service.deleteCampaignSchedule(created.id);

      expect(deleted).toBe(true);
      expect(service.getCampaignScheduleById(created.id)).toBeNull();
    });

    it('returns false for non-existent schedule', () => {
      const deleted = service.deleteCampaignSchedule(9999);

      expect(deleted).toBe(false);
    });
  });

  describe('deleteCampaignScheduleByCampaignId', () => {
    it('deletes schedule by campaign ID', () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
      });

      const deleted = service.deleteCampaignScheduleByCampaignId('cmp_001');

      expect(deleted).toBe(true);
      expect(service.getCampaignScheduleByCampaignId('cmp_001')).toBeNull();
    });

    it('returns false for non-existent campaign', () => {
      const deleted = service.deleteCampaignScheduleByCampaignId('nonexistent');

      expect(deleted).toBe(false);
    });
  });

  describe('getCampaignWithSchedule', () => {
    it('returns null for non-existent campaign', async () => {
      const result = await service.getCampaignWithSchedule('nonexistent');

      expect(result).toBeNull();
    });

    it('returns campaign without schedule', async () => {
      const result = await service.getCampaignWithSchedule('cmp_001');

      expect(result).not.toBeNull();
      expect(result?.campaignId).toBe('cmp_001');
      expect(result?.campaignName).toBe('Test Campaign');
      expect(result?.schedule).toBeNull();
    });

    it('returns campaign with schedule', async () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
        status: 'active',
      });

      const result = await service.getCampaignWithSchedule('cmp_001');

      expect(result).not.toBeNull();
      expect(result?.campaignId).toBe('cmp_001');
      expect(result?.schedule).not.toBeNull();
      expect(result?.schedule?.status).toBe('active');
    });
  });

  describe('getCampaignsWithSchedules', () => {
    it('returns empty array when sync fails', async () => {
      const errorProxy: IMetaAdsProxy = {
        getAdAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
        getCampaigns: vi.fn().mockResolvedValue({
          success: false,
          campaigns: [],
          adAccountId: 'act_123456',
          error: 'Sync failed',
        }),
        getCampaign: vi.fn().mockResolvedValue(null),
      };
      setMetaAdsProxy(errorProxy);

      const result = await service.getCampaignsWithSchedules('act_123456');

      expect(result).toEqual([]);
    });

    it('returns campaigns with their schedules', async () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
        status: 'active',
      });

      const result = await service.getCampaignsWithSchedules('act_123456');

      expect(result).toHaveLength(1);
      expect(result[0].campaignId).toBe('cmp_001');
      expect(result[0].schedule).not.toBeNull();
      expect(result[0].schedule?.status).toBe('active');
    });
  });

  describe('syncCampaigns', () => {
    it('syncs and returns campaigns', async () => {
      const result = await service.syncCampaigns('act_123456');

      expect(result).toHaveLength(1);
      expect(result[0].campaignId).toBe('cmp_001');
    });

    it('throws error on sync failure', async () => {
      const errorProxy: IMetaAdsProxy = {
        getAdAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
        getCampaigns: vi.fn().mockResolvedValue({
          success: false,
          campaigns: [],
          adAccountId: 'act_123456',
          error: 'Sync failed',
        }),
        getCampaign: vi.fn().mockResolvedValue(null),
      };
      setMetaAdsProxy(errorProxy);

      await expect(service.syncCampaigns('act_123456')).rejects.toThrow('Sync failed');
    });
  });

  describe('getSchedulesByDateRange', () => {
    it('returns schedules overlapping with date range', () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000,
        endDate: 2000,
      });

      const overlapping = service.getSchedulesByDateRange(1500, 2500);

      expect(overlapping).toHaveLength(1);
    });

    it('returns empty array for non-overlapping range', () => {
      service.createCampaignSchedule({
        campaignId: 'cmp_001',
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000,
        endDate: 2000,
      });

      const overlapping = service.getSchedulesByDateRange(3000, 4000);

      expect(overlapping).toHaveLength(0);
    });
  });
});

describe('isValidCampaignStatus', () => {
  it('returns true for valid statuses', () => {
    expect(isValidCampaignStatus('scheduled')).toBe(true);
    expect(isValidCampaignStatus('active')).toBe(true);
    expect(isValidCampaignStatus('paused')).toBe(true);
    expect(isValidCampaignStatus('completed')).toBe(true);
    expect(isValidCampaignStatus('cancelled')).toBe(true);
  });

  it('returns false for invalid statuses', () => {
    expect(isValidCampaignStatus('invalid')).toBe(false);
    expect(isValidCampaignStatus('')).toBe(false);
    expect(isValidCampaignStatus('ACTIVE')).toBe(false);
  });
});
