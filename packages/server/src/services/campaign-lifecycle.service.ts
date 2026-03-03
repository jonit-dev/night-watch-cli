/**
 * Campaign Lifecycle Service for Night Watch CLI.
 * Handles campaign creation, updates, and project default inheritance.
 */

import { inject, injectable } from 'tsyringe';

import type { ArticleStyle, IProjectContentPreferences, ImageStyle } from '@night-watch/core';
import { type ICreateCampaignInput, validateCreateCampaignInput } from '@night-watch/core';

// ==================== Campaign Record Type ====================

/**
 * Represents a campaign record as stored in the database.
 */
export interface ICampaignRecord {
  id: string;
  project_id: string;
  name: string;
  article_style: ArticleStyle | null;
  global_instructions: string | null;
  internal_links_count: number;
  include_youtube: boolean;
  include_cta: boolean;
  include_emojis: boolean;
  include_infographics: boolean;
  image_style: ImageStyle | null;
  auto_publish: boolean;
  created_at: number;
  updated_at: number;
}

/**
 * Result of campaign creation operation.
 */
export interface ICreateCampaignResult {
  success: boolean;
  campaign?: ICampaignRecord;
  error?: string;
}

// ==================== Project Repository Interface ====================

/**
 * Interface for fetching project data including content_preferences.
 * This would typically be implemented by a project repository.
 */
export interface IProjectRepository {
  getById(projectId: string): IProjectWithPreferences | null;
}

/**
 * Project record with content preferences.
 */
export interface IProjectWithPreferences {
  id: string;
  name: string;
  content_preferences: IProjectContentPreferences | null;
}

// ==================== Campaign Repository Interface ====================

/**
 * Interface for campaign persistence operations.
 */
export interface ICampaignRepository {
  create(campaign: Omit<ICampaignRecord, 'id' | 'created_at' | 'updated_at'>): ICampaignRecord;
  getById(campaignId: string): ICampaignRecord | null;
  getByProjectId(projectId: string): ICampaignRecord[];
  update(campaignId: string, updates: Partial<ICampaignRecord>): ICampaignRecord | null;
  delete(campaignId: string): boolean;
}

// ==================== Service Implementation ====================

/**
 * Service for managing campaign lifecycle operations.
 * Handles creation with project default inheritance.
 */
@injectable()
export class CampaignLifecycleService {
  constructor(
    @inject('ProjectRepository') private readonly projectRepo: IProjectRepository,
    @inject('CampaignRepository') private readonly campaignRepo: ICampaignRepository,
  ) {}

  /**
   * Creates a new campaign with project default inheritance.
   *
   * For any outrank field not explicitly provided, the service will:
   * 1. Check the project's content_preferences for a default value
   * 2. Fall back to null/0/false if neither input nor project sets the value
   *
   * @param input - The campaign creation input
   * @returns A result object with success status and created campaign or error
   */
  createCampaign(input: ICreateCampaignInput): ICreateCampaignResult {
    // Validate input
    const validation = validateCreateCampaignInput(input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Fetch project to get default content preferences
    const project = this.projectRepo.getById(input.projectId);
    if (!project) {
      return { success: false, error: `Project not found: ${input.projectId}` };
    }

    // Get project defaults (or empty object if not set)
    const defaults = project.content_preferences ?? {};

    // Helper to check if a field was explicitly provided in the input
    // This distinguishes between "not provided" (undefined) and "provided as null"
    const wasProvided = (key: keyof ICreateCampaignInput): boolean => key in input;

    // Apply project defaults for any outrank field not explicitly provided
    // If a field is explicitly set to null, that null value should be used (override)
    const articleStyle: ArticleStyle | null = wasProvided('articleStyle')
      ? (input.articleStyle ?? null)
      : (defaults.articleStyle ?? null);
    const internalLinksCount: number = wasProvided('internalLinksCount')
      ? (input.internalLinksCount ?? 1)
      : (defaults.internalLinksCount ?? 1);
    const globalInstructions: string | null = wasProvided('globalInstructions')
      ? (input.globalInstructions ?? null)
      : (defaults.globalInstructions ?? null);
    const imageStyle: ImageStyle | null = wasProvided('imageStyle')
      ? (input.imageStyle ?? null)
      : (defaults.imageStyle ?? null);

    // Boolean fields default to false if neither input nor project sets them
    const includeYoutube: boolean = wasProvided('includeYoutube')
      ? (input.includeYoutube ?? false)
      : (defaults.includeYoutube ?? false);
    const includeCta: boolean = wasProvided('includeCta')
      ? (input.includeCta ?? false)
      : (defaults.includeCta ?? false);
    const includeEmojis: boolean = wasProvided('includeEmojis')
      ? (input.includeEmojis ?? false)
      : (defaults.includeEmojis ?? false);
    const includeInfographics: boolean = wasProvided('includeInfographics')
      ? (input.includeInfographics ?? false)
      : (defaults.includeInfographics ?? false);
    const autoPublish: boolean = wasProvided('autoPublish') ? (input.autoPublish ?? false) : false; // autoPublish not in project defaults

    // Create the campaign record
    const campaign = this.campaignRepo.create({
      project_id: input.projectId,
      name: input.name,
      article_style: articleStyle,
      global_instructions: globalInstructions,
      internal_links_count: internalLinksCount,
      include_youtube: includeYoutube,
      include_cta: includeCta,
      include_emojis: includeEmojis,
      include_infographics: includeInfographics,
      image_style: imageStyle,
      auto_publish: autoPublish,
    });

    return { success: true, campaign };
  }

  /**
   * Gets a campaign by ID.
   * @param campaignId - The campaign ID
   * @returns The campaign record or null if not found
   */
  getCampaign(campaignId: string): ICampaignRecord | null {
    return this.campaignRepo.getById(campaignId);
  }

  /**
   * Gets all campaigns for a project.
   * @param projectId - The project ID
   * @returns Array of campaign records
   */
  getCampaignsByProject(projectId: string): ICampaignRecord[] {
    return this.campaignRepo.getByProjectId(projectId);
  }
}
