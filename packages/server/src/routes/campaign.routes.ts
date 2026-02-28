/**
 * Campaign routes: /api/campaigns/*
 *
 * Provides REST API endpoints for campaign calendar management.
 * Supports both single-project and global (multi-project) modes.
 */

import { Request, Response, Router } from 'express';

import { CampaignService, isValidCampaignStatus } from '../services/campaign.service.js';

const campaignService = new CampaignService();

/**
 * Dependencies for creating campaign routes in single-project mode.
 */
export interface ICampaignRoutesDeps {
  projectDir: string;
}

/**
 * Create campaign routes for single-project mode.
 */
export function createCampaignRoutes(_deps: ICampaignRoutesDeps): Router {
  const router = Router();

  /**
   * GET /api/campaigns/ad-accounts
   * List all available ad accounts from Meta Ads.
   */
  router.get('/ad-accounts', async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await campaignService.getAdAccounts();
      if (!result.success) {
        res.status(500).json({ error: result.error ?? 'Failed to fetch ad accounts' });
        return;
      }
      res.json(result.accounts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/campaigns
   * List all campaigns with their schedules.
   * Query params:
   *   - adAccountId: Filter by ad account ID (required)
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { adAccountId } = req.query as { adAccountId?: string };

      if (!adAccountId) {
        // Return all stored schedules if no ad account specified
        const schedules = campaignService.getCampaignSchedules();
        res.json(schedules);
        return;
      }

      const campaigns = await campaignService.getCampaignsWithSchedules(adAccountId);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/campaigns/:campaignId
   * Get a single campaign with its schedule.
   */
  router.get('/:campaignId', async (req: Request, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.campaignId as string;
      const campaign = await campaignService.getCampaignWithSchedule(campaignId);

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }

      res.json(campaign);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/campaigns/:campaignId/schedule
   * Create or update a schedule for a campaign.
   */
  router.post('/:campaignId/schedule', (req: Request, res: Response): void => {
    try {
      const campaignId = req.params.campaignId as string;
      const body = req.body as {
        adAccountId: string;
        campaignName: string;
        startDate: number;
        endDate: number;
        budgetSchedule?: unknown;
        status?: string;
      };

      // Validate required fields
      if (!body.adAccountId || !body.campaignName || !body.startDate || !body.endDate) {
        res.status(400).json({
          error: 'Missing required fields: adAccountId, campaignName, startDate, endDate',
        });
        return;
      }

      // Validate status if provided
      if (body.status && !isValidCampaignStatus(body.status)) {
        res.status(400).json({ error: `Invalid status: ${body.status}` });
        return;
      }

      // Validate dates
      if (body.startDate >= body.endDate) {
        res.status(400).json({ error: 'startDate must be before endDate' });
        return;
      }

      const schedule = campaignService.upsertCampaignSchedule(campaignId, {
        adAccountId: body.adAccountId,
        campaignName: body.campaignName,
        startDate: body.startDate,
        endDate: body.endDate,
        budgetSchedule: body.budgetSchedule as never,
        status: body.status as never,
      });

      res.json(schedule);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * DELETE /api/campaigns/:campaignId/schedule
   * Delete a campaign's schedule.
   */
  router.delete('/:campaignId/schedule', (req: Request, res: Response): void => {
    try {
      const campaignId = req.params.campaignId as string;
      const deleted = campaignService.deleteCampaignScheduleByCampaignId(campaignId);

      if (!deleted) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/campaigns/sync
   * Sync campaigns from Meta Ads.
   * Body: { adAccountId: string }
   */
  router.post('/sync', async (req: Request, res: Response): Promise<void> => {
    try {
      const { adAccountId } = req.body as { adAccountId?: string };

      if (!adAccountId) {
        res.status(400).json({ error: 'adAccountId is required' });
        return;
      }

      const campaigns = await campaignService.syncCampaigns(adAccountId);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Project-scoped campaign routes for global mode.
 * Mounted at /api/projects/:projectId/campaigns/*
 */
export function createProjectCampaignRoutes(): Router {
  const router = Router({ mergeParams: true });

  /**
   * GET /api/projects/:projectId/campaigns/ad-accounts
   * List all available ad accounts from Meta Ads.
   */
  router.get('/campaigns/ad-accounts', async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await campaignService.getAdAccounts();
      if (!result.success) {
        res.status(500).json({ error: result.error ?? 'Failed to fetch ad accounts' });
        return;
      }
      res.json(result.accounts);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/projects/:projectId/campaigns
   * List all campaigns with their schedules.
   * Query params:
   *   - adAccountId: Filter by ad account ID (optional)
   */
  router.get('/campaigns', async (req: Request, res: Response): Promise<void> => {
    try {
      const { adAccountId } = req.query as { adAccountId?: string };

      if (!adAccountId) {
        // Return all stored schedules if no ad account specified
        const schedules = campaignService.getCampaignSchedules();
        res.json(schedules);
        return;
      }

      const campaigns = await campaignService.getCampaignsWithSchedules(adAccountId);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/projects/:projectId/campaigns/:campaignId
   * Get a single campaign with its schedule.
   */
  router.get('/campaigns/:campaignId', async (req: Request, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.campaignId as string;
      const campaign = await campaignService.getCampaignWithSchedule(campaignId);

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }

      res.json(campaign);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/projects/:projectId/campaigns/:campaignId/schedule
   * Create or update a schedule for a campaign.
   */
  router.post('/campaigns/:campaignId/schedule', (req: Request, res: Response): void => {
    try {
      const campaignId = req.params.campaignId as string;
      const body = req.body as {
        adAccountId: string;
        campaignName: string;
        startDate: number;
        endDate: number;
        budgetSchedule?: unknown;
        status?: string;
      };

      // Validate required fields
      if (!body.adAccountId || !body.campaignName || !body.startDate || !body.endDate) {
        res.status(400).json({
          error: 'Missing required fields: adAccountId, campaignName, startDate, endDate',
        });
        return;
      }

      // Validate status if provided
      if (body.status && !isValidCampaignStatus(body.status)) {
        res.status(400).json({ error: `Invalid status: ${body.status}` });
        return;
      }

      // Validate dates
      if (body.startDate >= body.endDate) {
        res.status(400).json({ error: 'startDate must be before endDate' });
        return;
      }

      const schedule = campaignService.upsertCampaignSchedule(campaignId, {
        adAccountId: body.adAccountId,
        campaignName: body.campaignName,
        startDate: body.startDate,
        endDate: body.endDate,
        budgetSchedule: body.budgetSchedule as never,
        status: body.status as never,
      });

      res.json(schedule);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * DELETE /api/projects/:projectId/campaigns/:campaignId/schedule
   * Delete a campaign's schedule.
   */
  router.delete('/campaigns/:campaignId/schedule', (req: Request, res: Response): void => {
    try {
      const campaignId = req.params.campaignId as string;
      const deleted = campaignService.deleteCampaignScheduleByCampaignId(campaignId);

      if (!deleted) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/projects/:projectId/campaigns/sync
   * Sync campaigns from Meta Ads.
   * Body: { adAccountId: string }
   */
  router.post('/campaigns/sync', async (req: Request, res: Response): Promise<void> => {
    try {
      const { adAccountId } = req.body as { adAccountId?: string };

      if (!adAccountId) {
        res.status(400).json({ error: 'adAccountId is required' });
        return;
      }

      const campaigns = await campaignService.syncCampaigns(adAccountId);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
