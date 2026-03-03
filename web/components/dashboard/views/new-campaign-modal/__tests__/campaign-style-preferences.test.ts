import { describe, it, expect } from 'vitest';
import {
  ARTICLE_STYLE_OPTIONS,
  INTERNAL_LINKS_OPTIONS,
  IMAGE_STYLE_OPTIONS,
  TONE_OPTIONS,
  WORD_COUNT_OPTIONS,
  CONTENT_TOGGLE_CONFIGS,
} from '../constants.js';
import {
  campaignSchema,
  DEFAULT_CAMPAIGN_VALUES,
} from '../validationSchema.js';

describe('Campaign Style Preferences - Constants', () => {
  it('should have correct article style options', () => {
    expect(ARTICLE_STYLE_OPTIONS).toHaveLength(5);
    expect(ARTICLE_STYLE_OPTIONS[0]).toHaveProperty('value');
    expect(ARTICLE_STYLE_OPTIONS[0].value).toBe('informative');
    expect(ARTICLE_STYLE_OPTIONS[1].value).toBe('how-to');
  });

  it('should have correct internal links options', () => {
    expect(INTERNAL_LINKS_OPTIONS).toHaveLength(11);
    expect(INTERNAL_LINKS_OPTIONS[0]).toHaveProperty('value');
    expect(INTERNAL_LINKS_OPTIONS[0].value).toBe(0);
    expect(INTERNAL_LINKS_OPTIONS[10].value).toBe(10);
  });

  it('should have correct image style options', () => {
    expect(IMAGE_STYLE_OPTIONS).toHaveLength(5);
    expect(IMAGE_STYLE_OPTIONS[0]).toHaveProperty('value');
    expect(IMAGE_STYLE_OPTIONS[0].value).toBe('brand_text');
    expect(IMAGE_STYLE_OPTIONS[1].value).toBe('watercolor');
  });

  it('should have correct tone options', () => {
    expect(TONE_OPTIONS).toHaveLength(6);
    expect(TONE_OPTIONS[0]).toHaveProperty('value');
    expect(TONE_OPTIONS[0].value).toBe('professional');
    expect(TONE_OPTIONS[5].value).toBe('conversational');
  });

  it('should have correct word count options', () => {
    expect(WORD_COUNT_OPTIONS).toHaveLength(6);
    expect(WORD_COUNT_OPTIONS[0]).toHaveProperty('value');
    expect(WORD_COUNT_OPTIONS[0].value).toBe(500);
    expect(WORD_COUNT_OPTIONS[5].value).toBe(3000);
  });

  it('should have correct content toggle configs', () => {
    expect(CONTENT_TOGGLE_CONFIGS).toHaveLength(4);
    expect(CONTENT_TOGGLE_CONFIGS[0]).toHaveProperty('key');
    expect(CONTENT_TOGGLE_CONFIGS[0].key).toBe('includeYoutube');
    expect(CONTENT_TOGGLE_CONFIGS[3].key).toBe('includeInfographics');
  });
});

describe('Campaign Style Preferences - Validation', () => {
  it('should validate article style correctly', () => {
    const result = campaignSchema.safeParse({
      name: 'Test',
      keyword: 'test',
      articleStyle: 'invalid-style',
    });
    expect(result.success).toBe(false);
  });

  it('should validate internal links count correctly', () => {
    const result = campaignSchema.safeParse({
      name: 'Test',
      keyword: 'test',
      internalLinksCount: 25,
    });
    expect(result.success).toBe(false);
  });

  it('should validate global instructions max length', () => {
    const longInstructions = 'a'.repeat(2001);
    const result = campaignSchema.safeParse({
      name: 'Test',
      keyword: 'test',
      globalInstructions: longInstructions,
    });
    expect(result.success).toBe(false);
  });

  it('should provide default values', () => {
    expect(DEFAULT_CAMPAIGN_VALUES).toEqual({
      tone: 'professional',
      wordCount: 1500,
      autoPublish: false,
      imagePreset: null,
      articleStyle: 'informative',
      internalLinksCount: 2,
      globalInstructions: '',
      includeYoutube: false,
      includeCta: false,
      includeEmojis: false,
      includeInfographics: false,
    });
  });

  it('should accept valid article style values', () => {
    const validStyles = ['informative', 'how-to', 'listicle', 'opinion', 'tutorial'];
    validStyles.forEach((style) => {
      const result = campaignSchema.safeParse({
        name: 'Test',
        keyword: 'test',
        articleStyle: style,
      });
      expect(result.success).toBe(true);
    });
  });

  it('should accept valid image style values', () => {
    const validStyles = ['brand_text', 'watercolor', 'cinematic', 'illustration', 'sketch'];
    validStyles.forEach((style) => {
      const result = campaignSchema.safeParse({
        name: 'Test',
        keyword: 'test',
        imageStyle: style,
      });
      expect(result.success).toBe(true);
    });
  });
});
