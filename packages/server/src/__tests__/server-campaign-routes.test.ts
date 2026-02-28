/**
 * Tests for campaign API routes and schedule management.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';

import { createApp } from '../index.js';
import { closeDb, resetRepositories } from '@night-watch/core/utils/registry.js';
import {
  setMetaAdsProxy,
  resetMetaAdsProxy,
  type IMetaAdsProxy,
  type IAdAccount,
  type IMetaCampaign,
} from '@night-watch/core';

// Mock Meta Ads data
const mockAdAccounts: IAdAccount[] = [
  {
    id: 'act_123456',
    name: 'Test Ad Account',
    currency: 'USD',
    timezoneName: 'America/New_York',
    amountSpent: '10000',
    accountStatus: 1,
  },
  {
    id: 'act_789012',
    name: 'Another Ad Account',
    currency: 'EUR',
    timezoneName: 'Europe/London',
    amountSpent: '5000',
    accountStatus: 1,
  },
];

const mockCampaigns: IMetaCampaign[] = [
  {
    id: 'cmp_001',
    name: 'Summer Sale Campaign',
    status: 'ACTIVE',
    objective: 'CONVERSIONS',
    startTime: '2026-06-01T00:00:00Z',
    stopTime: '2026-06-30T23:59:59Z',
    dailyBudget: '10000',
    lifetimeBudget: null,
    accountId: 'act_123456',
  },
  {
    id: 'cmp_002',
    name: 'Winter Holiday Campaign',
    status: 'PAUSED',
    objective: 'AWARENESS',
    startTime: '2026-12-01T00:00:00Z',
    stopTime: '2026-12-31T23:59:59Z',
    dailyBudget: null,
    lifetimeBudget: '500000',
    accountId: 'act_123456',
  },
];

// Create mock proxy
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

describe('server campaign routes', () => {
  let tempDir: string;
  let nightWatchHome: string;
  let app: ReturnType<typeof createApp>;
  let mockProxy: IMetaAdsProxy;

  const buildConfig = {
    projectName: 'campaign-test-project',
    defaultBranch: 'main',
    provider: 'claude',
    reviewerEnabled: true,
    prdDirectory: 'docs/PRDs/night-watch',
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    cron: {
      executorSchedule: '0 0-21 * * *',
      reviewerSchedule: '0 0,3,6,9,12,15,18,21 * * *',
    },
    review: {
      minScore: 80,
      branchPatterns: ['feat/', 'night-watch/'],
    },
    logging: {
      maxLogSize: 524288,
    },
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-campaign-test-'));
    nightWatchHome = path.join(tempDir, '.night-watch-home');
    process.env.NIGHT_WATCH_HOME = nightWatchHome;

    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'campaign-test-project' }),
    );
    fs.writeFileSync(
      path.join(tempDir, 'night-watch.config.json'),
      JSON.stringify(buildConfig, null, 2),
    );
    fs.mkdirSync(path.join(tempDir, 'docs', 'PRDs', 'night-watch', 'done'), { recursive: true });

    closeDb();
    resetRepositories();

    // Set up mock proxy before creating app
    mockProxy = createMockProxy();
    setMetaAdsProxy(mockProxy);

    app = createApp(tempDir);
  });

  afterEach(() => {
    closeDb();
    resetRepositories();
    resetMetaAdsProxy();
    delete process.env.NIGHT_WATCH_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/campaigns/ad-accounts', () => {
    it('returns list of ad accounts', async () => {
      const response = await request(app).get('/api/campaigns/ad-accounts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('id', 'act_123456');
      expect(response.body[1]).toHaveProperty('id', 'act_789012');
    });

    it('handles proxy errors gracefully', async () => {
      const errorProxy: IMetaAdsProxy = {
        getAdAccounts: vi.fn().mockResolvedValue({
          success: false,
          accounts: [],
          error: 'API error',
        }),
        getCampaigns: vi.fn().mockResolvedValue({ success: true, campaigns: [], adAccountId: '' }),
        getCampaign: vi.fn().mockResolvedValue(null),
      };
      setMetaAdsProxy(errorProxy);

      const response = await request(app).get('/api/campaigns/ad-accounts');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'API error');
    });
  });

  describe('GET /api/campaigns', () => {
    it('returns all stored schedules when no adAccountId provided', async () => {
      const response = await request(app).get('/api/campaigns');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns campaigns with schedules for an ad account', async () => {
      const response = await request(app).get('/api/campaigns?adAccountId=act_123456');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('campaignId', 'cmp_001');
      expect(response.body[0]).toHaveProperty('campaignName', 'Summer Sale Campaign');
      expect(response.body[0]).toHaveProperty('status');
      expect(response.body[0]).toHaveProperty('schedule');
    });
  });

  describe('GET /api/campaigns/:campaignId', () => {
    it('returns a campaign with its schedule', async () => {
      const response = await request(app).get('/api/campaigns/cmp_001');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('campaignId', 'cmp_001');
      expect(response.body).toHaveProperty('campaignName', 'Summer Sale Campaign');
      expect(response.body).toHaveProperty('adAccountId', 'act_123456');
    });

    it('returns 404 for non-existent campaign', async () => {
      const response = await request(app).get('/api/campaigns/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Campaign not found');
    });
  });

  describe('POST /api/campaigns/:campaignId/schedule', () => {
    it('creates a new schedule', async () => {
      const scheduleData = {
        adAccountId: 'act_123456',
        campaignName: 'Summer Sale Campaign',
        startDate: Date.parse('2026-06-01T00:00:00Z'),
        endDate: Date.parse('2026-06-30T23:59:59Z'),
        status: 'scheduled',
      };

      const response = await request(app)
        .post('/api/campaigns/cmp_001/schedule')
        .send(scheduleData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('campaignId', 'cmp_001');
      expect(response.body).toHaveProperty('campaignName', 'Summer Sale Campaign');
      expect(response.body).toHaveProperty('status', 'scheduled');
    });

    it('validates required fields', async () => {
      const response = await request(app)
        .post('/api/campaigns/cmp_001/schedule')
        .send({ adAccountId: 'act_123456' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Missing required fields');
    });

    it('validates status value', async () => {
      const response = await request(app).post('/api/campaigns/cmp_001/schedule').send({
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 1000000,
        endDate: 2000000,
        status: 'invalid_status',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid status');
    });

    it('validates date order', async () => {
      const response = await request(app).post('/api/campaigns/cmp_001/schedule').send({
        adAccountId: 'act_123456',
        campaignName: 'Test Campaign',
        startDate: 2000000,
        endDate: 1000000,
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('startDate must be before endDate');
    });

    it('updates existing schedule on second call', async () => {
      const scheduleData = {
        adAccountId: 'act_123456',
        campaignName: 'Summer Sale Campaign',
        startDate: Date.parse('2026-06-01T00:00:00Z'),
        endDate: Date.parse('2026-06-30T23:59:59Z'),
        status: 'scheduled',
      };

      // Create first schedule
      const createResponse = await request(app)
        .post('/api/campaigns/cmp_001/schedule')
        .send(scheduleData);

      expect(createResponse.status).toBe(200);

      // Update the schedule
      const updateResponse = await request(app)
        .post('/api/campaigns/cmp_001/schedule')
        .send({
          ...scheduleData,
          status: 'active',
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body).toHaveProperty('status', 'active');
      expect(updateResponse.body).toHaveProperty('id', createResponse.body.id);
    });

    it('creates schedule with budget schedule', async () => {
      const scheduleData = {
        adAccountId: 'act_123456',
        campaignName: 'Summer Sale Campaign',
        startDate: Date.parse('2026-06-01T00:00:00Z'),
        endDate: Date.parse('2026-06-30T23:59:59Z'),
        status: 'scheduled',
        budgetSchedule: {
          baseAmount: 10000,
          schedules: [
            { date: Date.parse('2026-06-15T00:00:00Z'), amount: 15000, note: 'Mid-month boost' },
          ],
        },
      };

      const response = await request(app)
        .post('/api/campaigns/cmp_001/schedule')
        .send(scheduleData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('budgetSchedule');
      expect(response.body.budgetSchedule.baseAmount).toBe(10000);
      expect(response.body.budgetSchedule.schedules).toHaveLength(1);
    });
  });

  describe('DELETE /api/campaigns/:campaignId/schedule', () => {
    it('deletes an existing schedule', async () => {
      // First create a schedule
      await request(app)
        .post('/api/campaigns/cmp_001/schedule')
        .send({
          adAccountId: 'act_123456',
          campaignName: 'Summer Sale Campaign',
          startDate: Date.parse('2026-06-01T00:00:00Z'),
          endDate: Date.parse('2026-06-30T23:59:59Z'),
        });

      // Then delete it
      const response = await request(app).delete('/api/campaigns/cmp_001/schedule');

      expect(response.status).toBe(204);
    });

    it('returns 404 when deleting non-existent schedule', async () => {
      const response = await request(app).delete('/api/campaigns/nonexistent/schedule');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Schedule not found');
    });
  });

  describe('POST /api/campaigns/sync', () => {
    it('syncs campaigns from Meta Ads', async () => {
      const response = await request(app)
        .post('/api/campaigns/sync')
        .send({ adAccountId: 'act_123456' });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });

    it('requires adAccountId', async () => {
      const response = await request(app).post('/api/campaigns/sync').send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'adAccountId is required');
    });

    it('handles sync errors gracefully', async () => {
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

      const response = await request(app)
        .post('/api/campaigns/sync')
        .send({ adAccountId: 'act_123456' });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Sync failed');
    });
  });
});
