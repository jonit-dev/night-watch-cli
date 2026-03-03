import type { ArticleStyle, ImageStyle } from '@shared/types';

/**
 * Article style options for dropdown selection
 */
export const ARTICLE_STYLE_OPTIONS: { label: string; value: ArticleStyle }[] = [
  { label: 'Informative', value: 'informative' },
  { label: 'How-To Guide', value: 'how-to' },
  { label: 'Listicle', value: 'listicle' },
  { label: 'Opinion', value: 'opinion' },
  { label: 'Tutorial', value: 'tutorial' },
];

/**
 * Internal links count options for dropdown selection
 */
export const INTERNAL_LINKS_OPTIONS: { label: string; value: number }[] = [
  { label: '0 links', value: 0 },
  { label: '1 link', value: 1 },
  { label: '2 links', value: 2 },
  { label: '3 links', value: 3 },
  { label: '4 links', value: 4 },
  { label: '5 links', value: 5 },
  { label: '6 links', value: 6 },
  { label: '7 links', value: 7 },
  { label: '8 links', value: 8 },
  { label: '9 links', value: 9 },
  { label: '10+ links', value: 10 },
];

/**
 * Image style options for dropdown selection
 */
export const IMAGE_STYLE_OPTIONS: { label: string; value: ImageStyle }[] = [
  { label: 'Brand Text', value: 'brand_text' },
  { label: 'Watercolor', value: 'watercolor' },
  { label: 'Cinematic', value: 'cinematic' },
  { label: 'Illustration', value: 'illustration' },
  { label: 'Sketch', value: 'sketch' },
];

/**
 * Tone options for dropdown selection
 */
export const TONE_OPTIONS: { label: string; value: string }[] = [
  { label: 'Professional', value: 'professional' },
  { label: 'Casual', value: 'casual' },
  { label: 'Formal', value: 'formal' },
  { label: 'Friendly', value: 'friendly' },
  { label: 'Authoritative', value: 'authoritative' },
  { label: 'Conversational', value: 'conversational' },
];

/**
 * Word count options for dropdown selection
 */
export const WORD_COUNT_OPTIONS: { label: string; value: number }[] = [
  { label: '500 words', value: 500 },
  { label: '1000 words', value: 1000 },
  { label: '1500 words', value: 1500 },
  { label: '2000 words', value: 2000 },
  { label: '2500 words', value: 2500 },
  { label: '3000 words', value: 3000 },
];

/**
 * Content toggle configuration for checkboxes/switches
 */
export interface IContentToggleConfig {
  key: 'includeYoutube' | 'includeCta' | 'includeEmojis' | 'includeInfographics';
  label: string;
  description: string;
}

export const CONTENT_TOGGLE_CONFIGS: IContentToggleConfig[] = [
  {
    key: 'includeYoutube',
    label: 'YouTube Videos',
    description: 'Include relevant YouTube video embeds',
  },
  {
    key: 'includeCta',
    label: 'Call-to-Action',
    description: 'Add a call-to-action section',
  },
  {
    key: 'includeEmojis',
    label: 'Emojis',
    description: 'Use emojis throughout the article',
  },
  {
    key: 'includeInfographics',
    label: 'Infographics',
    description: 'Suggest infographic placeholders',
  },
];
