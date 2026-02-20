/**
 * Doctor routes: /api/doctor
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import { Request, Response, Router } from 'express';

import { CONFIG_FILE_NAME } from '@night-watch/core/constants.js';
import { INightWatchConfig } from '@night-watch/core/types.js';
import {
  generateMarker,
  getEntries,
  getProjectEntries,
} from '@night-watch/core/utils/crontab.js';

interface IHealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail?: string;
}

function runDoctorChecks(
  projectDir: string,
  config: INightWatchConfig,
): IHealthCheck[] {
  const checks: IHealthCheck[] = [];

  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: projectDir,
      stdio: 'pipe',
    });
    checks.push({ name: 'git', status: 'pass', detail: 'Git repository detected' });
  } catch {
    checks.push({ name: 'git', status: 'fail', detail: 'Not a git repository' });
  }

  try {
    execSync(`which ${config.provider}`, { stdio: 'pipe' });
    checks.push({
      name: 'provider',
      status: 'pass',
      detail: `Provider CLI found: ${config.provider}`,
    });
  } catch {
    checks.push({
      name: 'provider',
      status: 'fail',
      detail: `Provider CLI not found: ${config.provider}`,
    });
  }

  try {
    const projectName = path.basename(projectDir);
    const marker = generateMarker(projectName);
    const crontabEntries = [
      ...getEntries(marker),
      ...getProjectEntries(projectDir),
    ];
    if (crontabEntries.length > 0) {
      checks.push({
        name: 'crontab',
        status: 'pass',
        detail: `${crontabEntries.length} crontab entr(y/ies) installed`,
      });
    } else {
      checks.push({
        name: 'crontab',
        status: 'warn',
        detail: 'No crontab entries installed',
      });
    }
  } catch {
    checks.push({
      name: 'crontab',
      status: 'fail',
      detail: 'Failed to check crontab',
    });
  }

  const configPath = path.join(projectDir, CONFIG_FILE_NAME);
  if (fs.existsSync(configPath)) {
    checks.push({ name: 'config', status: 'pass', detail: 'Config file exists' });
  } else {
    checks.push({
      name: 'config',
      status: 'warn',
      detail: 'Config file not found (using defaults)',
    });
  }

  const prdDir = path.join(projectDir, config.prdDir);
  if (fs.existsSync(prdDir)) {
    const prds = fs
      .readdirSync(prdDir)
      .filter((f) => f.endsWith('.md') && f !== 'NIGHT-WATCH-SUMMARY.md');
    checks.push({
      name: 'prdDir',
      status: 'pass',
      detail: `PRD directory exists (${prds.length} PRDs)`,
    });
  } else {
    checks.push({
      name: 'prdDir',
      status: 'warn',
      detail: `PRD directory not found: ${config.prdDir}`,
    });
  }

  return checks;
}

export interface IDoctorRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

export function createDoctorRoutes(deps: IDoctorRoutesDeps): Router {
  const { projectDir, getConfig } = deps;
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    try {
      const checks = runDoctorChecks(projectDir, getConfig());
      res.json(checks);
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/**
 * Project-scoped doctor routes for global mode.
 */
export function createProjectDoctorRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/doctor', (req: Request, res: Response): void => {
    try {
      const checks = runDoctorChecks(req.projectDir!, req.projectConfig!);
      res.json(checks);
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
