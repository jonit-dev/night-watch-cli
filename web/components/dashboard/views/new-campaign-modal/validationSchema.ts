import { z } from 'zod';

/**
 * Article style options for content generation
 */
export const ArticleStyleSchema = z.enum([
  'informative',
  'how-to',
  'listicle',
  'opinion',
  'tutorial',
]);

/**
 * Image style options for content generation
 */
export const ImageStyleSchema = z.enum([
  'brand_text',
  'watercolor',
  'cinematic',
  'illustration',
  'sketch',
]);

/**
 * Campaign schema for the new campaign modal.
 * Includes basic campaign fields and outrank (style preferences) fields.
 */
export const campaignSchema = z.object({
  // Basic campaign fields
  name: z.string().min(1, 'Campaign name is required').max(100),
  keyword: z.string().min(1, 'Keyword is required').max(200),
  tone: z.string().optional(),
  wordCount: z.number().int().min(300).max(5000).optional(),
  aiModel: z.string().optional(),
  imagePreset: z.string().nullable().optional(),
  autoPublish: z.boolean().optional(),

  // Outrank fields (article style preferences)
  articleStyle: ArticleStyleSchema.optional(),
  internalLinksCount: z.number().int().min(0).max(20).optional(),
  globalInstructions: z.string().max(2000).optional(),
  includeYoutube: z.boolean().optional(),
  includeCta: z.boolean().optional(),
  includeEmojis: z.boolean().optional(),
  includeInfographics: z.boolean().optional(),
  imageStyle: ImageStyleSchema.optional(),
});

export type CampaignFormData = z.infer<typeof campaignSchema>;

/**
 * Default values for the campaign form
 */
export const DEFAULT_CAMPAIGN_VALUES: Partial<CampaignFormData> = {
  tone: 'professional',
  wordCount: 1500,
  autoPublish: false,
  imagePreset: null,
  // Default outrank values
  articleStyle: 'informative',
  internalLinksCount: 2,
  globalInstructions: '',
  includeYoutube: false,
  includeCta: false,
  includeEmojis: false,
  includeInfographics: false,
};
