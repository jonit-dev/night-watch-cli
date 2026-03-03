/**
 * Article-related type definitions for Night Watch CLI.
 */

// ==================== Article Style Preferences ====================

/**
 * Article style options for content generation
 */
export type ArticleStyle = 'informative' | 'how-to' | 'listicle' | 'opinion' | 'tutorial';

/**
 * Image style options for content generation
 */
export type ImageStyle = 'brand_text' | 'watercolor' | 'cinematic' | 'illustration' | 'sketch';

/**
 * Style preferences for article generation.
 * These preferences control how the AI generates article content.
 */
export interface IArticleStylePreferences {
  /** Article structure style (informative, how-to, listicle, etc.) */
  articleStyle?: ArticleStyle;
  /** Custom instructions from the user to include in generation */
  globalInstructions?: string;
  /** Number of internal links to include in the article */
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
  imageStyle?: ImageStyle;
}

// ==================== Article Generation Input ====================

/**
 * Internal link reference for article generation
 */
export interface IInternalLink {
  title: string;
  url: string;
}

/**
 * Input for article generation.
 * Contains all parameters needed to generate an article.
 */
export interface IGenerateArticleInput {
  /** Project ID for the campaign */
  projectId: string;
  /** Campaign ID */
  campaignId: string;
  /** Article keyword/topic */
  keyword: string;
  /** Target word count */
  targetWordCount?: number;
  /** AI model to use for generation */
  aiModel?: string;
  /** Tone of the article */
  tone?: string;
  /** Image preset configuration */
  imagePreset?: string;
  /** Style preferences for article generation */
  stylePreferences?: IArticleStylePreferences;
  /** Internal links to include in the article (fetched from published articles) */
  internalLinks?: Array<IInternalLink>;
}
