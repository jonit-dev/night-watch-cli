/**
 * Campaign and schedule types for Night Watch CLI.
 * Supports calendar-based campaign management for Meta Ads campaigns.
 */

/** Valid campaign statuses for scheduling */
export const VALID_CAMPAIGN_STATUSES = [
  'scheduled',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;

export type CampaignStatus = (typeof VALID_CAMPAIGN_STATUSES)[number];

/**
 * Budget schedule entry for day-parted budget adjustments.
 * Allows specifying different budget amounts for specific dates.
 */
export interface IBudgetScheduleEntry {
  /** Unix timestamp for the date this budget applies to */
  date: number;
  /** Budget amount in account currency (micros or actual depending on Meta API) */
  amount: number;
  /** Optional note for this budget change */
  note?: string;
}

/**
 * Full budget schedule configuration for a campaign.
 */
export interface IBudgetSchedule {
  /** Base daily budget amount */
  baseAmount: number;
  /** Scheduled budget adjustments by date */
  schedules: IBudgetScheduleEntry[];
}

/**
 * A campaign schedule record persisted in the database.
 * Tracks Meta Ads campaign scheduling information.
 */
export interface ICampaignSchedule {
  /** Unique identifier for this schedule record */
  id: number;
  /** Meta Ads campaign ID */
  campaignId: string;
  /** Meta Ads ad account ID */
  adAccountId: string;
  /** Human-readable campaign name */
  campaignName: string;
  /** Campaign start date as Unix timestamp */
  startDate: number;
  /** Campaign end date as Unix timestamp */
  endDate: number;
  /** JSON-serialized budget schedule configuration */
  budgetSchedule: IBudgetSchedule | null;
  /** Current scheduling status */
  status: CampaignStatus;
  /** Record creation timestamp */
  createdAt: number;
  /** Record last update timestamp */
  updatedAt: number;
}

/**
 * Input type for creating a new campaign schedule.
 * Omits auto-generated fields (id, createdAt, updatedAt).
 */
export type CreateCampaignScheduleInput = Omit<ICampaignSchedule, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Input type for updating an existing campaign schedule.
 * All fields are optional for partial updates.
 */
export type UpdateCampaignScheduleInput = Partial<CreateCampaignScheduleInput>;

/**
 * Campaign with its associated schedule information.
 * Used for calendar view display.
 */
export interface ICampaignWithSchedule {
  /** Meta Ads campaign ID */
  campaignId: string;
  /** Meta Ads ad account ID */
  adAccountId: string;
  /** Human-readable campaign name */
  campaignName: string;
  /** Campaign start date as Unix timestamp */
  startDate: number;
  /** Campaign end date as Unix timestamp */
  endDate: number;
  /** Current scheduling status */
  status: CampaignStatus;
  /** Associated schedule record, if any */
  schedule: ICampaignSchedule | null;
}
