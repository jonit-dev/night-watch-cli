/**
 * Tests for campaign style defaults inheritance.
 * Verifies that campaigns inherit article style preferences from project defaults.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { container } from 'tsyringe';

import 'reflect-metadata';
import {
  CampaignLifecycleService,
  type ICampaignRecord,
  type IProjectRepository,
  type IProjectWithPreferences,
  type ICampaignRepository,
} from '../../services/campaign-lifecycle.service.js';
import type { ICreateCampaignInput } from '@night-watch/core/shared/validation/campaign.schema.js';
import type {
  ArticleStyle,
  ImageStyle,
  IProjectContentPreferences,
} from '@night-watch/core/shared/types.js';

// ==================== Mock Repositories ====================

class MockProjectRepository implements IProjectRepository {
  private projects: Map<string, IProjectWithPreferences> = new Map();

  setProject(project: IProjectWithPreferences): void {
    this.projects.set(project.id, project);
  }

  getById(projectId: string): IProjectWithPreferences | null {
    return this.projects.get(projectId) ?? null;
  }

  clear(): void {
    this.projects.clear();
  }
}

class MockCampaignRepository implements ICampaignRepository {
  private campaigns: Map<string, ICampaignRecord> = new Map();
  private idCounter = 1;

  create(campaign: Omit<ICampaignRecord, 'id' | 'created_at' | 'updated_at'>): ICampaignRecord {
    const now = Math.floor(Date.now() / 1000);
    const id = `campaign-${this.idCounter++}`;
    const record: ICampaignRecord = {
      ...campaign,
      id,
      created_at: now,
      updated_at: now,
    };
    this.campaigns.set(id, record);
    return record;
  }

  getById(campaignId: string): ICampaignRecord | null {
    return this.campaigns.get(campaignId) ?? null;
  }

  getByProjectId(projectId: string): ICampaignRecord[] {
    return Array.from(this.campaigns.values()).filter((c) => c.project_id === projectId);
  }

  update(campaignId: string, updates: Partial<ICampaignRecord>): ICampaignRecord | null {
    const existing = this.campaigns.get(campaignId);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updated_at: Math.floor(Date.now() / 1000) };
    this.campaigns.set(campaignId, updated);
    return updated;
  }

  delete(campaignId: string): boolean {
    return this.campaigns.delete(campaignId);
  }

  clear(): void {
    this.campaigns.clear();
    this.idCounter = 1;
  }
}

// ==================== Tests ====================

describe('CampaignLifecycleService - Style Defaults Inheritance', () => {
  let service: CampaignLifecycleService;
  let mockProjectRepo: MockProjectRepository;
  let mockCampaignRepo: MockCampaignRepository;

  beforeEach(() => {
    container.reset();

    mockProjectRepo = new MockProjectRepository();
    mockCampaignRepo = new MockCampaignRepository();

    container.registerInstance('ProjectRepository', mockProjectRepo);
    container.registerInstance('CampaignRepository', mockCampaignRepo);

    service = container.resolve(CampaignLifecycleService);
  });

  afterEach(() => {
    mockProjectRepo.clear();
    mockCampaignRepo.clear();
    container.reset();
  });

  describe('createCampaign', () => {
    const projectId = 'project-1';

    beforeEach(() => {
      // Set up a project without content preferences
      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: null,
      });
    });

    it('should inherit articleStyle from project content_preferences when not explicitly set', () => {
      // Set project with article style preference
      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: {
          articleStyle: 'how-to' as ArticleStyle,
        },
      });

      const input: ICreateCampaignInput = {
        projectId,
        name: 'New Campaign',
        // articleStyle NOT provided - should inherit from project
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(true);
      expect(result.campaign).toBeDefined();
      expect(result.campaign?.article_style).toBe('how-to');
    });

    it('should use campaign-level value when explicitly set (override project default)', () => {
      // Set project with article style preference
      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: {
          articleStyle: 'how-to' as ArticleStyle,
        },
      });

      const input: ICreateCampaignInput = {
        projectId,
        name: 'New Campaign',
        articleStyle: 'listicle', // Explicitly set - should override project default
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(true);
      expect(result.campaign).toBeDefined();
      expect(result.campaign?.article_style).toBe('listicle');
    });

    it('should default to null/0/false when neither project nor campaign sets the value', () => {
      // Project has null content_preferences
      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: null,
      });

      const input: ICreateCampaignInput = {
        projectId,
        name: 'New Campaign',
        // No style preferences provided
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(true);
      expect(result.campaign).toBeDefined();

      // Verify defaults
      expect(result.campaign?.article_style).toBeNull();
      expect(result.campaign?.global_instructions).toBeNull();
      expect(result.campaign?.internal_links_count).toBe(1); // Default is 1
      expect(result.campaign?.include_youtube).toBe(false);
      expect(result.campaign?.include_cta).toBe(false);
      expect(result.campaign?.include_emojis).toBe(false);
      expect(result.campaign?.include_infographics).toBe(false);
      expect(result.campaign?.image_style).toBeNull();
      expect(result.campaign?.auto_publish).toBe(false);
    });

    it('should inherit all style preferences from project defaults', () => {
      const projectPrefs: IProjectContentPreferences = {
        articleStyle: 'tutorial' as ArticleStyle,
        globalInstructions: 'Use simple language',
        internalLinksCount: 3,
        includeYoutube: true,
        includeCta: true,
        includeEmojis: true,
        includeInfographics: true,
        imageStyle: 'cinematic' as ImageStyle,
      };

      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: projectPrefs,
      });

      const input: ICreateCampaignInput = {
        projectId,
        name: 'New Campaign',
        // No style preferences provided - should inherit all from project
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(true);
      expect(result.campaign).toBeDefined();
      expect(result.campaign?.article_style).toBe('tutorial');
      expect(result.campaign?.global_instructions).toBe('Use simple language');
      expect(result.campaign?.internal_links_count).toBe(3);
      expect(result.campaign?.include_youtube).toBe(true);
      expect(result.campaign?.include_cta).toBe(true);
      expect(result.campaign?.include_emojis).toBe(true);
      expect(result.campaign?.include_infographics).toBe(true);
      expect(result.campaign?.image_style).toBe('cinematic');
    });

    it('should allow partial override of project defaults', () => {
      const projectPrefs: IProjectContentPreferences = {
        articleStyle: 'how-to' as ArticleStyle,
        globalInstructions: 'Use formal tone',
        internalLinksCount: 5,
        includeYoutube: true,
        includeCta: true,
        includeEmojis: false,
        includeInfographics: true,
        imageStyle: 'illustration' as ImageStyle,
      };

      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: projectPrefs,
      });

      const input: ICreateCampaignInput = {
        projectId,
        name: 'New Campaign',
        articleStyle: 'listicle', // Override
        includeEmojis: true, // Override
        // Other fields should inherit from project
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(true);
      expect(result.campaign).toBeDefined();

      // Overridden values
      expect(result.campaign?.article_style).toBe('listicle');
      expect(result.campaign?.include_emojis).toBe(true);

      // Inherited values
      expect(result.campaign?.global_instructions).toBe('Use formal tone');
      expect(result.campaign?.internal_links_count).toBe(5);
      expect(result.campaign?.include_youtube).toBe(true);
      expect(result.campaign?.include_cta).toBe(true);
      expect(result.campaign?.include_infographics).toBe(true);
      expect(result.campaign?.image_style).toBe('illustration');
    });

    it('should return error when project not found', () => {
      const input: ICreateCampaignInput = {
        projectId: 'non-existent-project',
        name: 'New Campaign',
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Project not found');
      expect(result.campaign).toBeUndefined();
    });

    it('should return error when validation fails', () => {
      const input = {
        projectId: projectId,
        // Missing required 'name' field
      } as ICreateCampaignInput;

      const result = service.createCampaign(input);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.campaign).toBeUndefined();
    });

    it('should handle null article style override to clear project default', () => {
      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: {
          articleStyle: 'how-to' as ArticleStyle,
        },
      });

      const input: ICreateCampaignInput = {
        projectId,
        name: 'New Campaign',
        articleStyle: null, // Explicitly set to null - should override project default
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(true);
      expect(result.campaign?.article_style).toBeNull();
    });

    it('should use provided internalLinksCount even if 0', () => {
      mockProjectRepo.setProject({
        id: projectId,
        name: 'Test Project',
        content_preferences: {
          internalLinksCount: 5,
        },
      });

      const input: ICreateCampaignInput = {
        projectId,
        name: 'New Campaign',
        internalLinksCount: 0, // Explicitly set to 0 - should be used
      };

      const result = service.createCampaign(input);

      expect(result.success).toBe(true);
      expect(result.campaign?.internal_links_count).toBe(0);
    });
  });

  describe('getCampaign', () => {
    it('should return null for non-existent campaign', () => {
      const campaign = service.getCampaign('non-existent');
      expect(campaign).toBeNull();
    });

    it('should return campaign by ID', () => {
      mockProjectRepo.setProject({
        id: 'project-1',
        name: 'Test Project',
        content_preferences: null,
      });

      const createResult = service.createCampaign({
        projectId: 'project-1',
        name: 'Test Campaign',
      });

      expect(createResult.success).toBe(true);
      const campaignId = createResult.campaign!.id;

      const campaign = service.getCampaign(campaignId);
      expect(campaign).not.toBeNull();
      expect(campaign?.name).toBe('Test Campaign');
    });
  });

  describe('getCampaignsByProject', () => {
    it('should return empty array for project with no campaigns', () => {
      const campaigns = service.getCampaignsByProject('project-1');
      expect(campaigns).toEqual([]);
    });

    it('should return all campaigns for a project', () => {
      mockProjectRepo.setProject({
        id: 'project-1',
        name: 'Test Project',
        content_preferences: null,
      });

      service.createCampaign({
        projectId: 'project-1',
        name: 'Campaign 1',
      });

      service.createCampaign({
        projectId: 'project-1',
        name: 'Campaign 2',
      });

      const campaigns = service.getCampaignsByProject('project-1');
      expect(campaigns).toHaveLength(2);
      expect(campaigns.map((c) => c.name)).toContain('Campaign 1');
      expect(campaigns.map((c) => c.name)).toContain('Campaign 2');
    });
  });
});
