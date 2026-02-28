/**
 * Meta Ads MCP proxy integration.
 *
 * Provides an abstraction layer for calling Meta Ads MCP tools.
 * The actual MCP tool calls are handled externally (via the CLI's MCP integration).
 * This module provides interfaces and a default implementation that can be
 * replaced or mocked for testing.
 */

/**
 * Ad account representation from Meta Ads API.
 */
export interface IAdAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  amountSpent: string;
  accountStatus: number;
}

/**
 * Campaign representation from Meta Ads API.
 */
export interface IMetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  startTime: string | null;
  stopTime: string | null;
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  accountId: string;
}

/**
 * Result of syncing campaigns from Meta Ads.
 */
export interface ISyncCampaignsResult {
  success: boolean;
  campaigns: IMetaCampaign[];
  adAccountId: string;
  error?: string;
}

/**
 * Result of fetching ad accounts.
 */
export interface IGetAdAccountsResult {
  success: boolean;
  accounts: IAdAccount[];
  error?: string;
}

/**
 * Interface for the Meta Ads proxy.
 * Can be implemented differently for testing or alternative integrations.
 */
export interface IMetaAdsProxy {
  /**
   * Get all accessible ad accounts.
   */
  getAdAccounts(): Promise<IGetAdAccountsResult>;

  /**
   * Get campaigns for a specific ad account.
   */
  getCampaigns(adAccountId: string): Promise<ISyncCampaignsResult>;

  /**
   * Get a single campaign by ID.
   */
  getCampaign(campaignId: string): Promise<IMetaCampaign | null>;
}

/**
 * Default implementation of IMetaAdsProxy.
 * In production, this would interface with the actual MCP tools.
 * For now, it returns empty results as a placeholder that can be
 * replaced with actual MCP integration.
 */
export class DefaultMetaAdsProxy implements IMetaAdsProxy {
  async getAdAccounts(): Promise<IGetAdAccountsResult> {
    // Placeholder: In production, this would call the MCP tool mcp__meta-ads__get_ad_accounts
    // For now, return empty result - actual implementation will use MCP tools
    return {
      success: true,
      accounts: [],
    };
  }

  async getCampaigns(adAccountId: string): Promise<ISyncCampaignsResult> {
    // Placeholder: In production, this would call the MCP tool mcp__meta-ads__get_campaigns
    // For now, return empty result - actual implementation will use MCP tools
    return {
      success: true,
      campaigns: [],
      adAccountId,
    };
  }

  async getCampaign(_campaignId: string): Promise<IMetaCampaign | null> {
    // Placeholder: In production, this would call the MCP tool mcp__meta-ads__get_campaign_details
    // For now, return null - actual implementation will use MCP tools
    return null;
  }
}

/**
 * Global proxy instance.
 * Can be replaced with a custom implementation for testing.
 */
let _proxy: IMetaAdsProxy = new DefaultMetaAdsProxy();

/**
 * Get the current Meta Ads proxy instance.
 */
export function getMetaAdsProxy(): IMetaAdsProxy {
  return _proxy;
}

/**
 * Set a custom Meta Ads proxy instance.
 * Useful for testing or alternative integrations.
 */
export function setMetaAdsProxy(proxy: IMetaAdsProxy): void {
  _proxy = proxy;
}

/**
 * Reset the proxy to the default implementation.
 */
export function resetMetaAdsProxy(): void {
  _proxy = new DefaultMetaAdsProxy();
}

/**
 * Parse a Meta Ads date string to Unix timestamp.
 * Meta Ads dates are typically in ISO 8601 format.
 */
export function parseMetaAdsDate(dateStr: string | null): number {
  if (!dateStr) return 0;
  const timestamp = Date.parse(dateStr);
  return isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Convert a Meta Ads campaign to our internal campaign format.
 */
export function toInternalCampaign(campaign: IMetaCampaign): Pick<
  IMetaCampaign,
  'id' | 'name' | 'accountId'
> & {
  startDate: number;
  endDate: number;
} {
  return {
    id: campaign.id,
    name: campaign.name,
    accountId: campaign.accountId,
    startDate: parseMetaAdsDate(campaign.startTime),
    endDate: parseMetaAdsDate(campaign.stopTime),
  };
}
