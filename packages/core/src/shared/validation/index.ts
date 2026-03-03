/**
 * Barrel export for shared validation schemas.
 */

export {
  VALID_ARTICLE_STYLES,
  VALID_IMAGE_STYLES,
  isValidArticleStyle,
  isValidImageStyle,
  validateCreateCampaignInput,
  validateUpdateCampaignInput,
} from './campaign.schema.js';

export type { ICreateCampaignInput, IUpdateCampaignInput } from './campaign.schema.js';
