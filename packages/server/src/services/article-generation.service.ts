/**
 * Article Generation Service
 *
 * Orchestrates the article generation workflow, including fetching internal links
 * and passing style preferences to the prompt generation functions.
 */

import { inject, injectable } from 'tsyringe';

import {
  IArticleRepository,
  type IArticleStylePreferences,
  type IGenerateArticleInput,
  type IInternalLink,
} from '@night-watch/core';

/**
 * Variables for rendering the outline prompt
 */
export interface IOutlinePromptVars {
  keyword: string;
  targetWordCount?: number;
  tone?: string;
  stylePreferences?: IArticleStylePreferences;
}

/**
 * Variables for rendering the full article prompt
 */
export interface IArticlePromptVars {
  keyword: string;
  outline: string;
  targetWordCount?: number;
  tone?: string;
  stylePreferences?: IArticleStylePreferences;
  internalLinks?: IInternalLink[];
}

/**
 * Result of outline generation
 */
export interface IOutlineResult {
  outline: string;
  sections: string[];
}

/**
 * Result of full article generation
 */
export interface IArticleResult {
  title: string;
  content: string;
  wordCount: number;
}

@injectable()
export class ArticleGenerationService {
  private readonly articleRepository: IArticleRepository;

  constructor(@inject('SqliteArticleRepository') articleRepository: IArticleRepository) {
    this.articleRepository = articleRepository;
  }

  /**
   * Fetch internal links from published articles for a project.
   * Returns an array of title/URL pairs for linking within the article.
   *
   * @param projectId - The project ID to fetch links for
   * @param limit - Maximum number of links to return
   * @returns Array of internal link references
   */
  private fetchInternalLinks(projectId: string, limit: number): IInternalLink[] {
    if (limit <= 0) {
      return [];
    }
    const links = this.articleRepository.getPublishedLinks(projectId, limit);
    return links.map((link) => ({
      title: link.title,
      url: link.url,
    }));
  }

  /**
   * Generate an article outline based on the input parameters.
   * Passes style preferences to the outline prompt.
   *
   * @param input - The article generation input
   * @param stylePreferences - Style preferences for generation
   * @returns The generated outline result
   */
  async generateOutline(
    input: IGenerateArticleInput,
    stylePreferences?: IArticleStylePreferences,
  ): Promise<IOutlineResult> {
    const promptVars: IOutlinePromptVars = {
      keyword: input.keyword,
      targetWordCount: input.targetWordCount,
      tone: input.tone,
      stylePreferences,
    };

    // Render the outline prompt (placeholder for actual AI generation)
    // In a real implementation, this prompt would be sent to an AI service
    void this.renderOutlinePrompt(promptVars);

    // Placeholder: In a real implementation, this would call an AI service
    // For now, return a basic outline structure
    return {
      outline: `Outline for: ${input.keyword}`,
      sections: ['Introduction', 'Main Content', 'Conclusion'],
    };
  }

  /**
   * Generate a full article based on the outline and input parameters.
   * Passes style preferences and internal links to the article prompt.
   *
   * @param input - The article generation input
   * @param outline - The generated outline
   * @param stylePreferences - Style preferences for generation
   * @param internalLinks - Internal links to include in the article
   * @returns The generated article result
   */
  async generateFullArticle(
    input: IGenerateArticleInput,
    outline: string,
    stylePreferences?: IArticleStylePreferences,
    internalLinks?: IInternalLink[],
  ): Promise<IArticleResult> {
    const promptVars: IArticlePromptVars = {
      keyword: input.keyword,
      outline,
      targetWordCount: input.targetWordCount,
      tone: input.tone,
      stylePreferences,
      internalLinks,
    };

    // Render the article prompt (placeholder for actual AI generation)
    void this.renderArticlePrompt(promptVars);

    // Placeholder: In a real implementation, this would call an AI service
    // For now, return a basic article structure
    return {
      title: `Article about: ${input.keyword}`,
      content: `Content for ${input.keyword} based on outline: ${outline}`,
      wordCount: 500,
    };
  }

  /**
   * Main article generation flow.
   * Fetches internal links if needed and orchestrates the generation process.
   *
   * @param input - The article generation input
   * @returns The generated article result
   */
  async generateArticle(input: IGenerateArticleInput): Promise<IArticleResult> {
    // Extract style preferences and internal links count from input
    const { stylePreferences } = input;
    const internalLinksCount = stylePreferences?.internalLinksCount ?? 0;

    // Fetch internal links if needed
    let internalLinks: IInternalLink[] | undefined;
    if (internalLinksCount > 0) {
      internalLinks = this.fetchInternalLinks(input.projectId, internalLinksCount);
    }

    // Generate outline with style preferences
    const outlineResult = await this.generateOutline(input, stylePreferences);

    // Generate full article with style preferences and internal links
    const articleResult = await this.generateFullArticle(
      input,
      outlineResult.outline,
      stylePreferences,
      internalLinks,
    );

    return articleResult;
  }

  /**
   * Render the outline prompt with the given variables.
   * This is a placeholder that would be replaced with actual prompt template rendering.
   */
  private renderOutlinePrompt(vars: IOutlinePromptVars): string {
    const styleSection = vars.stylePreferences
      ? this.formatStylePreferences(vars.stylePreferences)
      : '';

    return `Generate an outline for an article about: ${vars.keyword}

Target word count: ${vars.targetWordCount ?? 'Not specified'}
Tone: ${vars.tone ?? 'Professional'}

${styleSection}`;
  }

  /**
   * Render the article prompt with the given variables.
   * This is a placeholder that would be replaced with actual prompt template rendering.
   */
  private renderArticlePrompt(vars: IArticlePromptVars): string {
    const styleSection = vars.stylePreferences
      ? this.formatStylePreferences(vars.stylePreferences)
      : '';

    const linksSection =
      vars.internalLinks && vars.internalLinks.length > 0
        ? `Internal links to include:\n${vars.internalLinks.map((l) => `- ${l.title}: ${l.url}`).join('\n')}`
        : '';

    return `Generate a full article based on the following outline:

${vars.outline}

Keyword: ${vars.keyword}
Target word count: ${vars.targetWordCount ?? 'Not specified'}
Tone: ${vars.tone ?? 'Professional'}

${styleSection}
${linksSection}`;
  }

  /**
   * Format style preferences for inclusion in prompts.
   */
  private formatStylePreferences(prefs: IArticleStylePreferences): string {
    const parts: string[] = ['Style preferences:'];

    if (prefs.articleStyle) {
      parts.push(`- Article style: ${prefs.articleStyle}`);
    }
    if (prefs.globalInstructions) {
      parts.push(`- Global instructions: ${prefs.globalInstructions}`);
    }
    if (prefs.includeYoutube) {
      parts.push(`- Include YouTube embeds: yes`);
    }
    if (prefs.includeCta) {
      parts.push(`- Include CTA: yes`);
    }
    if (prefs.includeEmojis) {
      parts.push(`- Include emojis: yes`);
    }
    if (prefs.includeInfographics) {
      parts.push(`- Include infographics: yes`);
    }
    if (prefs.imageStyle) {
      parts.push(`- Image style: ${prefs.imageStyle}`);
    }

    return parts.join('\n');
  }
}
