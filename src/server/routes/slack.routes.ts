/**
 * Slack integration routes: /api/slack/*
 */

import { Request, Response, Router } from 'express';

import { SlackClient } from '@/slack/client.js';

export function createSlackRoutes(): Router {
  const router = Router();

  router.post('/channels', async (req: Request, res: Response): Promise<void> => {
    try {
      const { botToken } = (req.body ?? {}) as { botToken?: string };
      if (!botToken || typeof botToken !== 'string') {
        res.status(400).json({ error: 'botToken is required' });
        return;
      }

      const slack = new SlackClient(botToken);
      const channels = await slack.listChannels();
      res.json(channels);
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post(
    '/channels/create',
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { botToken, name } = (req.body ?? {}) as {
          botToken?: string;
          name?: string;
        };
        if (!botToken || typeof botToken !== 'string') {
          res.status(400).json({ error: 'botToken is required' });
          return;
        }
        if (!name || typeof name !== 'string') {
          res.status(400).json({ error: 'name is required' });
          return;
        }

        const slack = new SlackClient(botToken);
        const channelId = await slack.createChannel(name);
        let invitedCount = 0;
        let inviteWarning: string | null = null;
        let welcomeMessagePosted = false;

        // Auto-invite everyone in the workspace
        try {
          const users = await slack.listUsers();
          const userIds = users.map((u) => u.id);
          if (userIds.length > 0) {
            invitedCount = await slack.inviteUsers(channelId, userIds);
          }
        } catch (inviteErr) {
          console.warn('Failed to auto-invite users to new channel:', inviteErr);
          inviteWarning =
            inviteErr instanceof Error
              ? inviteErr.message
              : String(inviteErr);
        }

        // Post a first message so the channel pops up in the user's Slack
        try {
          await slack.postMessage(
            channelId,
            `👋 *Night Watch AI* has linked this channel for integration. Ready to work!`,
          );
          welcomeMessagePosted = true;
        } catch (msgErr) {
          console.warn(
            'Failed to post welcome message to new channel:',
            msgErr,
          );
        }

        res.json({
          channelId,
          invitedCount,
          inviteWarning,
          welcomeMessagePosted,
        });
      } catch (error) {
        res
          .status(500)
          .json({
            error: error instanceof Error ? error.message : String(error),
          });
      }
    },
  );

  return router;
}
