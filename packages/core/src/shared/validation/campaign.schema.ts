/**
 * Validation schema for campaign creation and update operations.
 * Defines the structure and validation rules for campaign outrank fields.
 */

import type { ArticleStyle, ImageStyle } from '../types/article.types.js';

// ==================== Input Types ====================

/**
 * Input type for creating a new campaign.
 * All outrank fields are optional - they will inherit from project defaults if not provided.
 */
export interface ICreateCampaignInput {
  /** Project ID this campaign belongs to */
  projectId: string;
  /** Campaign name */
  name: string;
  /** Article structure style */
  articleStyle?: ArticleStyle | null;
  /** Custom instructions from the user */
  globalInstructions?: string | null;
  /** Number of internal links to include */
  internalLinksCount?: number;
  /** Whether to suggest YouTube video embeds */
  includeYoutube?: boolean;
  /** Whether to include a call-to-action section */
  includeCta?: boolean;
  /** Whether to use emojis in the article */
  includeEmojis?: boolean;
  /** Whether to suggest infographic placeholders */
  includeInfographics?: boolean;
  /** Visual style for generated images */
  imageStyle?: ImageStyle | null;
  /** Whether to auto-publish generated articles */
  autoPublish?: boolean;
}

/**
 * Input type for updating an existing campaign.
 * All fields are optional - only provided fields will be updated.
 */
export interface IUpdateCampaignInput {
  /** Campaign name */
  name?: string;
  /** Article structure style */
  articleStyle?: ArticleStyle | null;
  /** Custom instructions from the user */
  globalInstructions?: string | null;
  /** Number of internal links to include */
  internalLinksCount?: number;
  /** Whether to suggest YouTube video embeds */
  includeYoutube?: boolean;
  /** Whether to include a call-to-action section */
  includeCta?: boolean;
  /** Whether to use emojis in the article */
  includeEmojis?: boolean;
  /** Whether to suggest infographic placeholders */
  includeInfographics?: boolean;
  /** Visual style for generated images */
  imageStyle?: ImageStyle | null;
  /** Whether to auto-publish generated articles */
  autoPublish?: boolean;
}

// ==================== Valid Values ====================

/** Valid article style values */
export const VALID_ARTICLE_STYLES = [
  'informative',
  'how-to',
  'listicle',
  'opinion',
  'tutorial',
] as const;

/** Valid image style values */
export const VALID_IMAGE_STYLES = [
  'brand_text',
  'watercolor',
  'cinematic',
  'illustration',
  'sketch',
] as const;

// ==================== Validation Functions ====================

/**
 * Validates that a value is a valid ArticleStyle.
 * @param value - The value to validate
 * @returns true if valid, false otherwise
 */
export function isValidArticleStyle(value: unknown): value is ArticleStyle {
  return typeof value === 'string' && VALID_ARTICLE_STYLES.includes(value as ArticleStyle);
}

/**
 * Validates that a value is a valid ImageStyle.
 * @param value - The value to validate
 * @returns true if valid, false otherwise
 */
export function isValidImageStyle(value: unknown): value is ImageStyle {
  return typeof value === 'string' && VALID_IMAGE_STYLES.includes(value as ImageStyle);
}

/**
 * Validates create campaign input.
 * @param input - The input to validate
 * @returns An object with valid flag and error message if invalid
 */
export function validateCreateCampaignInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const data = input as Record<string, unknown>;

  // Required fields
  if (typeof data.projectId !== 'string' || data.projectId.trim() === '') {
    return { valid: false, error: 'projectId is required and must be a non-empty string' };
  }

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    return { valid: false, error: 'name is required and must be a non-empty string' };
  }

  // Optional string fields that must be valid if provided
  if (
    data.globalInstructions !== undefined &&
    data.globalInstructions !== null &&
    typeof data.globalInstructions !== 'string'
  ) {
    return { valid: false, error: 'globalInstructions must be a string or null' };
  }

  // Validate article style if provided
  if (data.articleStyle !== undefined && data.articleStyle !== null) {
    if (!isValidArticleStyle(data.articleStyle)) {
      return {
        valid: false,
        error: `articleStyle must be one of: ${VALID_ARTICLE_STYLES.join(', ')}`,
      };
    }
  }

  // Validate image style if provided
  if (data.imageStyle !== undefined && data.imageStyle !== null) {
    if (!isValidImageStyle(data.imageStyle)) {
      return { valid: false, error: `imageStyle must be one of: ${VALID_IMAGE_STYLES.join(', ')}` };
    }
  }

  // Validate numeric fields
  if (data.internalLinksCount !== undefined) {
    if (
      typeof data.internalLinksCount !== 'number' ||
      data.internalLinksCount < 0 ||
      !Number.isInteger(data.internalLinksCount)
    ) {
      return { valid: false, error: 'internalLinksCount must be a non-negative integer' };
    }
  }

  // Validate boolean fields
  const booleanFields = [
    'includeYoutube',
    'includeCta',
    'includeEmojis',
    'includeInfographics',
    'autoPublish',
  ];
  for (const field of booleanFields) {
    if (data[field] !== undefined && typeof data[field] !== 'boolean') {
      return { valid: false, error: `${field} must be a boolean` };
    }
  }

  return { valid: true };
}

/**
 * Validates update campaign input.
 * @param input - The input to validate
 * @returns An object with valid flag and error message if invalid
 */
export function validateUpdateCampaignInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const data = input as Record<string, unknown>;

  // At least one field must be provided
  const updatableFields = [
    'name',
    'articleStyle',
    'globalInstructions',
    'internalLinksCount',
    'includeYoutube',
    'includeCta',
    'includeEmojis',
    'includeInfographics',
    'imageStyle',
    'autoPublish',
  ];

  const hasUpdates = updatableFields.some((field) => data[field] !== undefined);
  if (!hasUpdates) {
    return { valid: false, error: 'At least one field must be provided for update' };
  }

  // Validate name if provided
  if (data.name !== undefined && (typeof data.name !== 'string' || data.name.trim() === '')) {
    return { valid: false, error: 'name must be a non-empty string' };
  }

  // Optional string fields that must be valid if provided
  if (
    data.globalInstructions !== undefined &&
    data.globalInstructions !== null &&
    typeof data.globalInstructions !== 'string'
  ) {
    return { valid: false, error: 'globalInstructions must be a string or null' };
  }

  // Validate article style if provided
  if (data.articleStyle !== undefined && data.articleStyle !== null) {
    if (!isValidArticleStyle(data.articleStyle)) {
      return {
        valid: false,
        error: `articleStyle must be one of: ${VALID_ARTICLE_STYLES.join(', ')}`,
      };
    }
  }

  // Validate image style if provided
  if (data.imageStyle !== undefined && data.imageStyle !== null) {
    if (!isValidImageStyle(data.imageStyle)) {
      return { valid: false, error: `imageStyle must be one of: ${VALID_IMAGE_STYLES.join(', ')}` };
    }
  }

  // Validate numeric fields
  if (data.internalLinksCount !== undefined) {
    if (
      typeof data.internalLinksCount !== 'number' ||
      data.internalLinksCount < 0 ||
      !Number.isInteger(data.internalLinksCount)
    ) {
      return { valid: false, error: 'internalLinksCount must be a non-negative integer' };
    }
  }

  // Validate boolean fields
  const booleanFields = [
    'includeYoutube',
    'includeCta',
    'includeEmojis',
    'includeInfographics',
    'autoPublish',
  ];
  for (const field of booleanFields) {
    if (data[field] !== undefined && typeof data[field] !== 'boolean') {
      return { valid: false, error: `${field} must be a boolean` };
    }
  }

  return { valid: true };
}
