/**
 * Campaign-related type definitions for Night Watch CLI.
 */

import type { ArticleStyle, ImageStyle } from './article.types.js';

// ==================== Campaign Outrank Fields ====================

/**
 * Fields from the campaign table that control Outrank-style article generation.
 * This helper type is used for extracting these fields from campaign records.
 */
export interface ICampaignOutrankFields {
  /** Article structure style */
  article_style: ArticleStyle | null;
  /** Custom instructions from the user */
  global_instructions: string | null;
  /** Number of internal links to include */
  internal_links_count: number;
  /** Whether to suggest YouTube video embeds */
  include_youtube: boolean;
  /** Whether to include a call-to-action section */
  include_cta: boolean;
  /** Whether to use emojis in the article */
  include_emojis: boolean;
  /** Whether to suggest infographic placeholders */
  include_infographics: boolean;
  /** Visual style for generated images */
  image_style: ImageStyle | null;
}

/**
 * Type alias for picking outrank fields from a campaign object.
 * Use this when extracting style preferences from a campaign record.
 */
export type CampaignOutrankFields = keyof ICampaignOutrankFields;
