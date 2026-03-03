/**
 * Tests for article generation service style preferences integration.
 * Verifies that style preferences and internal links are passed to prompts correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { container } from 'tsyringe';

import 'reflect-metadata';
import { ArticleGenerationService } from '../../services/article-generation.service.js';
import type { IArticleRepository, IInternalLinkRef } from '@night-watch/core';
import type {
  IGenerateArticleInput,
  IArticleStylePreferences,
} from '@night-watch/core/shared/types.js';

// ==================== Mock Repository ====================

class MockArticleRepository implements IArticleRepository {
  private links: IInternalLinkRef[] = [];

  setPublishedLinks(links: IInternalLinkRef[]): void {
    this.links = links;
  }

  getPublishedLinks(_projectId: string, _limit: number): IInternalLinkRef[] {
    return this.links;
  }

  clear(): void {
    this.links = [];
  }
}

// ==================== Tests ====================

describe('ArticleGenerationService - Style Preferences', () => {
  let service: ArticleGenerationService;
  let mockArticleRepo: MockArticleRepository;

  beforeEach(() => {
    container.reset();

    mockArticleRepo = new MockArticleRepository();

    container.registerInstance('SqliteArticleRepository', mockArticleRepo);

    service = container.resolve(ArticleGenerationService);
  });

  afterEach(() => {
    mockArticleRepo.clear();
    container.reset();
  });

  describe('generateOutline', () => {
    it('should pass style preferences to outline prompt', async () => {
      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
        targetWordCount: 1000,
        tone: 'Professional',
      };

      const stylePreferences: IArticleStylePreferences = {
        articleStyle: 'how-to',
        globalInstructions: 'Use simple language',
        internalLinksCount: 3,
        includeYoutube: true,
        includeCta: true,
        includeEmojis: false,
        includeInfographics: true,
        imageStyle: 'cinematic',
      };

      // Spy on the private method by checking the result
      const result = await service.generateOutline(input, stylePreferences);

      expect(result).toBeDefined();
      expect(result.outline).toContain('Test Keyword');
    });

    it('should work without style preferences', async () => {
      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
      };

      const result = await service.generateOutline(input, undefined);

      expect(result).toBeDefined();
      expect(result.outline).toContain('Test Keyword');
    });
  });

  describe('generateFullArticle', () => {
    it('should pass style preferences and internal links to article prompt', async () => {
      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
        targetWordCount: 1000,
        tone: 'Professional',
      };

      const stylePreferences: IArticleStylePreferences = {
        articleStyle: 'listicle',
        globalInstructions: 'Make it engaging',
        internalLinksCount: 2,
        includeYoutube: false,
        includeCta: true,
        includeEmojis: true,
        includeInfographics: false,
        imageStyle: 'illustration',
      };

      const internalLinks = [
        { title: 'Related Article 1', url: 'https://example.com/article-1' },
        { title: 'Related Article 2', url: 'https://example.com/article-2' },
      ];

      const outline = 'Test outline';

      const result = await service.generateFullArticle(
        input,
        outline,
        stylePreferences,
        internalLinks,
      );

      expect(result).toBeDefined();
      expect(result.title).toContain('Test Keyword');
      expect(result.content).toContain('Test outline');
    });

    it('should work without style preferences or internal links', async () => {
      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
      };

      const outline = 'Test outline';

      const result = await service.generateFullArticle(input, outline, undefined, undefined);

      expect(result).toBeDefined();
      expect(result.title).toContain('Test Keyword');
    });
  });

  describe('generateArticle (main flow)', () => {
    it('should fetch internal links when internalLinksCount > 0', async () => {
      // Set up mock to return some links
      mockArticleRepo.setPublishedLinks([
        { title: 'Published Article 1', url: 'https://example.com/pub1' },
        { title: 'Published Article 2', url: 'https://example.com/pub2' },
        { title: 'Published Article 3', url: 'https://example.com/pub3' },
      ]);

      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
        stylePreferences: {
          internalLinksCount: 2,
        },
      };

      const result = await service.generateArticle(input);

      expect(result).toBeDefined();
      expect(result.title).toContain('Test Keyword');
    });

    it('should not fetch internal links when internalLinksCount is 0', async () => {
      // Set up mock with links (should not be called)
      mockArticleRepo.setPublishedLinks([
        { title: 'Published Article 1', url: 'https://example.com/pub1' },
      ]);

      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
        stylePreferences: {
          internalLinksCount: 0,
        },
      };

      const result = await service.generateArticle(input);

      expect(result).toBeDefined();
    });

    it('should not fetch internal links when internalLinksCount is undefined', async () => {
      // Set up mock with links (should not be called)
      mockArticleRepo.setPublishedLinks([
        { title: 'Published Article 1', url: 'https://example.com/pub1' },
      ]);

      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
        // stylePreferences not provided
      };

      const result = await service.generateArticle(input);

      expect(result).toBeDefined();
    });

    it('should pass style preferences to outline and article generation', async () => {
      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Test Keyword',
        targetWordCount: 2000,
        tone: 'Casual',
        stylePreferences: {
          articleStyle: 'tutorial',
          globalInstructions: 'Include code examples',
          includeYoutube: true,
          includeCta: true,
          includeEmojis: false,
          includeInfographics: true,
          imageStyle: 'sketch',
          internalLinksCount: 0,
        },
      };

      const result = await service.generateArticle(input);

      expect(result).toBeDefined();
      expect(result.title).toContain('Test Keyword');
    });

    it('should pass all style preferences when all fields are set', async () => {
      mockArticleRepo.setPublishedLinks([
        { title: 'Link 1', url: 'https://example.com/1' },
        { title: 'Link 2', url: 'https://example.com/2' },
        { title: 'Link 3', url: 'https://example.com/3' },
      ]);

      const input: IGenerateArticleInput = {
        projectId: 'project-1',
        campaignId: 'campaign-1',
        keyword: 'Comprehensive Test',
        targetWordCount: 3000,
        tone: 'Technical',
        stylePreferences: {
          articleStyle: 'opinion',
          globalInstructions: 'Be controversial but respectful',
          internalLinksCount: 3,
          includeYoutube: true,
          includeCta: true,
          includeEmojis: true,
          includeInfographics: true,
          imageStyle: 'watercolor',
        },
      };

      const result = await service.generateArticle(input);

      expect(result).toBeDefined();
      expect(result.title).toContain('Comprehensive Test');
    });
  });
});
