/**
 * CampaignService — injectable service for campaign and schedule management.
 *
 * Provides operations for fetching campaigns from Meta Ads, managing schedules,
 * and combining campaign data with schedule information.
 */

import { injectable } from 'tsyringe';

import {
  CreateCampaignScheduleInput,
  ICampaignSchedule,
  ICampaignWithSchedule,
  IGetAdAccountsResult,
  IMetaCampaign,
  ISyncCampaignsResult,
  UpdateCampaignScheduleInput,
  VALID_CAMPAIGN_STATUSES,
  getMetaAdsProxy,
} from '@night-watch/core';
import { getRepositories } from '@night-watch/core';

export type { IGetAdAccountsResult, ISyncCampaignsResult, IMetaCampaign };

/**
 * Input for creating or updating a schedule via the API.
 */
export interface IUpsertScheduleInput {
  adAccountId: string;
  campaignName: string;
  startDate: number;
  endDate: number;
  budgetSchedule?: CreateCampaignScheduleInput['budgetSchedule'];
  status?: CreateCampaignScheduleInput['status'];
}

@injectable()
export class CampaignService {
  /**
   * Get all accessible ad accounts from Meta Ads.
   */
  async getAdAccounts(): Promise<IGetAdAccountsResult> {
    const proxy = getMetaAdsProxy();
    return proxy.getAdAccounts();
  }

  /**
   * Get campaigns from Meta Ads for a specific ad account.
   */
  async getCampaigns(adAccountId: string): Promise<ISyncCampaignsResult> {
    const proxy = getMetaAdsProxy();
    return proxy.getCampaigns(adAccountId);
  }

  /**
   * Get a single campaign from Meta Ads by ID.
   */
  async getCampaign(campaignId: string): Promise<IMetaCampaign | null> {
    const proxy = getMetaAdsProxy();
    return proxy.getCampaign(campaignId);
  }

  /**
   * Get all stored campaign schedules from the database.
   */
  getCampaignSchedules(): ICampaignSchedule[] {
    const repos = getRepositories();
    return repos.campaignSchedule.getAll();
  }

  /**
   * Get a single campaign schedule by campaign ID.
   */
  getCampaignScheduleByCampaignId(campaignId: string): ICampaignSchedule | null {
    const repos = getRepositories();
    return repos.campaignSchedule.getByCampaignId(campaignId);
  }

  /**
   * Get a single campaign schedule by its internal ID.
   */
  getCampaignScheduleById(id: number): ICampaignSchedule | null {
    const repos = getRepositories();
    return repos.campaignSchedule.getById(id);
  }

  /**
   * Get all schedules within a date range.
   */
  getSchedulesByDateRange(start: number, end: number): ICampaignSchedule[] {
    const repos = getRepositories();
    return repos.campaignSchedule.getByDateRange(start, end);
  }

  /**
   * Get a campaign with its associated schedule.
   * Combines data from Meta Ads API and local database.
   */
  async getCampaignWithSchedule(campaignId: string): Promise<ICampaignWithSchedule | null> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) return null;

    const schedule = this.getCampaignScheduleByCampaignId(campaignId);

    return {
      campaignId: campaign.id,
      adAccountId: campaign.accountId,
      campaignName: campaign.name,
      startDate: schedule?.startDate ?? this.parseDate(campaign.startTime),
      endDate: schedule?.endDate ?? this.parseDate(campaign.stopTime),
      status: schedule?.status ?? this.mapMetaStatus(campaign.status),
      schedule,
    };
  }

  /**
   * Get all campaigns with their schedules for an ad account.
   */
  async getCampaignsWithSchedules(adAccountId: string): Promise<ICampaignWithSchedule[]> {
    const result = await this.getCampaigns(adAccountId);
    if (!result.success) return [];

    const schedules = this.getCampaignSchedules();
    const scheduleMap = new Map(schedules.map((s) => [s.campaignId, s]));

    return result.campaigns.map((campaign): ICampaignWithSchedule => {
      const schedule = scheduleMap.get(campaign.id) ?? null;
      return {
        campaignId: campaign.id,
        adAccountId: campaign.accountId,
        campaignName: campaign.name,
        startDate: schedule?.startDate ?? this.parseDate(campaign.startTime),
        endDate: schedule?.endDate ?? this.parseDate(campaign.stopTime),
        status: schedule?.status ?? this.mapMetaStatus(campaign.status),
        schedule,
      };
    });
  }

  /**
   * Create a new campaign schedule.
   */
  createCampaignSchedule(input: IUpsertScheduleInput & { campaignId: string }): ICampaignSchedule {
    const repos = getRepositories();

    // Check if a schedule already exists for this campaign
    const existing = repos.campaignSchedule.getByCampaignId(input.campaignId);
    if (existing) {
      throw new Error(`Schedule already exists for campaign ${input.campaignId}`);
    }

    const createInput: CreateCampaignScheduleInput = {
      campaignId: input.campaignId,
      adAccountId: input.adAccountId,
      campaignName: input.campaignName,
      startDate: input.startDate,
      endDate: input.endDate,
      budgetSchedule: input.budgetSchedule ?? null,
      status: input.status ?? 'scheduled',
    };

    return repos.campaignSchedule.create(createInput);
  }

  /**
   * Update an existing campaign schedule.
   */
  updateCampaignSchedule(
    id: number,
    updates: UpdateCampaignScheduleInput,
  ): ICampaignSchedule | null {
    const repos = getRepositories();
    const existing = repos.campaignSchedule.getById(id);
    if (!existing) return null;

    return repos.campaignSchedule.update(id, updates);
  }

  /**
   * Upsert (create or update) a campaign schedule.
   * If a schedule exists for the campaign, it updates it; otherwise creates a new one.
   */
  upsertCampaignSchedule(campaignId: string, input: IUpsertScheduleInput): ICampaignSchedule {
    const repos = getRepositories();
    const existing = repos.campaignSchedule.getByCampaignId(campaignId);

    if (existing) {
      const updates: UpdateCampaignScheduleInput = {
        adAccountId: input.adAccountId,
        campaignName: input.campaignName,
        startDate: input.startDate,
        endDate: input.endDate,
        budgetSchedule: input.budgetSchedule,
        status: input.status,
      };
      return repos.campaignSchedule.update(existing.id, updates)!;
    }

    return this.createCampaignSchedule({ ...input, campaignId });
  }

  /**
   * Delete a campaign schedule by its internal ID.
   */
  deleteCampaignSchedule(id: number): boolean {
    const repos = getRepositories();
    return repos.campaignSchedule.delete(id);
  }

  /**
   * Delete a campaign schedule by campaign ID.
   */
  deleteCampaignScheduleByCampaignId(campaignId: string): boolean {
    const repos = getRepositories();
    const existing = repos.campaignSchedule.getByCampaignId(campaignId);
    if (!existing) return false;
    return repos.campaignSchedule.delete(existing.id);
  }

  /**
   * Sync campaigns from Meta Ads and return updated data.
   */
  async syncCampaigns(adAccountId: string): Promise<ICampaignWithSchedule[]> {
    const result = await this.getCampaigns(adAccountId);
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to sync campaigns');
    }
    return this.getCampaignsWithSchedules(adAccountId);
  }

  /**
   * Parse a Meta Ads date string to Unix timestamp.
   */
  private parseDate(dateStr: string | null): number {
    if (!dateStr) return 0;
    const timestamp = Date.parse(dateStr);
    return isNaN(timestamp) ? 0 : timestamp;
  }

  /**
   * Map Meta Ads campaign status to our internal status.
   */
  private mapMetaStatus(metaStatus: string): ICampaignWithSchedule['status'] {
    const normalized = metaStatus.toLowerCase();
    switch (normalized) {
      case 'active':
        return 'active';
      case 'paused':
        return 'paused';
      case 'completed':
      case 'archived':
        return 'completed';
      case 'cancelled':
      case 'deleted':
        return 'cancelled';
      case 'scheduled':
        return 'scheduled';
      default:
        return 'scheduled';
    }
  }
}

/**
 * Validate a campaign status value.
 */
export function isValidCampaignStatus(status: string): status is ICampaignWithSchedule['status'] {
  return VALID_CAMPAIGN_STATUSES.includes(status as ICampaignWithSchedule['status']);
}
