/**
 * Agent persona routes: /api/agents/*
 */

import { Request, Response, Router } from 'express';

import {
  CreateAgentPersonaInput,
  UpdateAgentPersonaInput,
} from '@night-watch/core/shared/types.js';
import { getRepositories } from '@night-watch/core/storage/repositories/index.js';
import { maskPersonaSecrets } from '../helpers.js';

export function createAgentRoutes(): Router {
  const router = Router();

  router.post('/seed-defaults', (_req: Request, res: Response): void => {
    try {
      const repos = getRepositories();
      repos.agentPersona.seedDefaults();
      res.json({ message: 'Default personas seeded successfully' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/', (_req: Request, res: Response): void => {
    try {
      const repos = getRepositories();
      const personas = repos.agentPersona.getAll();
      const masked = personas.map(maskPersonaSecrets);
      res.json(masked);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:id', (req: Request, res: Response): ReturnType<typeof res.json> => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.getById(req.params.id as string);
      if (!persona) return res.status(404).json({ error: 'Agent not found' });
      const masked = maskPersonaSecrets(persona);
      return res.json(masked);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:id/prompt', async (req: Request, res: Response): Promise<ReturnType<typeof res.json>> => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.getById(req.params.id as string);
      if (!persona) return res.status(404).json({ error: 'Agent not found' });
      const { compileSoul } = await import('@night-watch/core/agents/soul-compiler.js');
      const prompt = compileSoul(persona);
      return res.json({ prompt });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/', (req: Request, res: Response): ReturnType<typeof res.json> => {
    try {
      const repos = getRepositories();
      const input = req.body as CreateAgentPersonaInput;
      if (!input.name || !input.role) {
        return res.status(400).json({ error: 'name and role are required' });
      }
      const persona = repos.agentPersona.create(input);
      return res.status(201).json(maskPersonaSecrets(persona));
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  router.put('/:id', (req: Request, res: Response): ReturnType<typeof res.json> => {
    try {
      const repos = getRepositories();
      const persona = repos.agentPersona.update(
        req.params.id as string,
        req.body as UpdateAgentPersonaInput,
      );
      return res.json(maskPersonaSecrets(persona));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found'))
        return res.status(404).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  router.delete('/:id', (req: Request, res: Response): void => {
    try {
      const repos = getRepositories();
      repos.agentPersona.delete(req.params.id as string);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/avatar', (req: Request, res: Response): ReturnType<typeof res.json> => {
    try {
      const repos = getRepositories();
      const { avatarUrl } = req.body as { avatarUrl: string };
      if (!avatarUrl)
        return res.status(400).json({ error: 'avatarUrl is required' });
      const persona = repos.agentPersona.update(req.params.id as string, {
        avatarUrl,
      });
      return res.json(maskPersonaSecrets(persona));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found'))
        return res.status(404).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  return router;
}
