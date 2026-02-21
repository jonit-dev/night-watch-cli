/**
 * Middleware that resolves a project from the registry by :projectId param.
 * Used in global (multi-project) mode.
 */

import * as fs from 'fs';
import * as path from 'path';

import { NextFunction, Request, Response } from 'express';

import { CONFIG_FILE_NAME, loadConfig, loadRegistry } from '@night-watch/core';

export function resolveProject(req: Request, res: Response, next: NextFunction): void {
  const projectId = req.params.projectId as string;
  // Decode ~ back to / (frontend encodes / as ~ to avoid Express 5 %2F routing issues)
  const decodedId = decodeURIComponent(projectId).replace(/~/g, '/');
  const entries = loadRegistry();
  const entry = entries.find((e) => e.name === decodedId);

  if (!entry) {
    res.status(404).json({ error: `Project not found: ${decodedId}` });
    return;
  }

  if (!fs.existsSync(entry.path) || !fs.existsSync(path.join(entry.path, CONFIG_FILE_NAME))) {
    res.status(404).json({ error: `Project path invalid or missing config: ${entry.path}` });
    return;
  }

  req.projectDir = entry.path;
  req.projectConfig = loadConfig(entry.path);
  next();
}
