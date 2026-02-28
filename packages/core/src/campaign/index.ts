/**
 * Campaign module exports for Night Watch CLI.
 */

export type {
  IBudgetSchedule,
  IBudgetScheduleEntry,
  ICampaignSchedule,
  ICampaignWithSchedule,
  CreateCampaignScheduleInput,
  UpdateCampaignScheduleInput,
} from './types.js';

export { VALID_CAMPAIGN_STATUSES } from './types.js';

export type { CampaignStatus } from './types.js';

export {
  DefaultMetaAdsProxy,
  getMetaAdsProxy,
  setMetaAdsProxy,
  resetMetaAdsProxy,
  parseMetaAdsDate,
  toInternalCampaign,
} from './meta-ads-proxy.js';

export type {
  IAdAccount,
  IMetaCampaign,
  ISyncCampaignsResult,
  IGetAdAccountsResult,
  IMetaAdsProxy,
} from './meta-ads-proxy.js';
