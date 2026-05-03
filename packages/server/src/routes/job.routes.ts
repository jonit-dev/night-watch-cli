/**
 * Signed job dispatch routes: /api/jobs/:id/run.
 */

import { spawn } from 'child_process';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

import { Request, Response, Router } from 'express';

import {
  INightWatchConfig,
  JOB_REGISTRY,
  JobType,
  analyticsLockPath,
  auditLockPath,
  checkLockFile,
  executorLockPath,
  mergerLockPath,
  plannerLockPath,
  prResolverLockPath,
  qaLockPath,
  reviewerLockPath,
} from '@night-watch/core';

interface IJobRoutesDeps {
  projectDir: string;
  getConfig: () => INightWatchConfig;
}

interface IProjectJobRoutesDeps {
  getConfig: (req: Request) => INightWatchConfig;
  getProjectDir: (req: Request) => string;
  pathPrefix: string;
}

interface IJobDispatchResponse {
  accepted: true;
  jobId: JobType;
  pid: number;
  dispatchId: string;
}

function getRawBody(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf-8');
  }
  return Buffer.alloc(0);
}

export function verifyHmacSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  const match = header?.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(match[1], 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getSignatureHeaders(req: Request): Array<string | undefined> {
  return [req.get('X-Night-Watch-Signature'), req.get('X-Hub-Signature-256')];
}

function getLockPathForJob(projectDir: string, jobId: JobType): string {
  switch (jobId) {
    case 'executor':
      return executorLockPath(projectDir);
    case 'reviewer':
      return reviewerLockPath(projectDir);
    case 'qa':
      return qaLockPath(projectDir);
    case 'audit':
      return auditLockPath(projectDir);
    case 'slicer':
    case 'planner':
      return plannerLockPath(projectDir);
    case 'analytics':
      return analyticsLockPath(projectDir);
    case 'pr-resolver':
      return prResolverLockPath(projectDir);
    case 'merger':
      return mergerLockPath(projectDir);
  }
}

function createJobRouteHandlers(ctx: IProjectJobRoutesDeps): Router {
  const router = Router({ mergeParams: true });
  const p = ctx.pathPrefix;

  router.post(`/${p}:id/run`, (req: Request, res: Response): void => {
    try {
      const config = ctx.getConfig(req);
      const webhookConfig = config.webhookTriggers;
      if (!webhookConfig.enabled) {
        res.status(403).json({ error: 'Webhook triggers are disabled' });
        return;
      }

      const secret = process.env[webhookConfig.secretEnv];
      if (!secret) {
        res.status(403).json({ error: 'Webhook signing secret is not configured' });
        return;
      }

      const rawBody = getRawBody(req);
      const hasValidSignature = getSignatureHeaders(req).some((header) =>
        verifyHmacSignature(rawBody, header, secret),
      );
      if (!hasValidSignature) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const requestedJobId = req.params.id;
      const jobDef = JOB_REGISTRY.find((job) => job.id === requestedJobId);
      if (!jobDef) {
        res.status(404).json({ error: 'Unknown job id' });
        return;
      }

      if (!webhookConfig.allowedJobIds.includes(jobDef.id)) {
        res.status(403).json({ error: 'Job is not allowed for webhook dispatch' });
        return;
      }

      const projectDir = ctx.getProjectDir(req);
      const lock = checkLockFile(getLockPathForJob(projectDir, jobDef.id));
      if (lock.running) {
        res.status(409).json({
          error: `${jobDef.name} is already running (PID ${lock.pid})`,
          pid: lock.pid,
        });
        return;
      }

      const dispatchId = randomUUID();
      const child = spawn('night-watch', [jobDef.cliCommand], {
        detached: true,
        stdio: 'ignore',
        cwd: projectDir,
        env: {
          ...process.env,
          NW_WEBHOOK_DISPATCH_ID: dispatchId,
          NW_WEBHOOK_JOB_ID: jobDef.id,
        },
      });

      child.unref();

      if (child.pid === undefined) {
        res.status(500).json({ error: 'Failed to spawn process: no PID assigned' });
        return;
      }

      const response: IJobDispatchResponse = {
        accepted: true,
        jobId: jobDef.id,
        pid: child.pid,
        dispatchId,
      };
      res.status(202).json(response);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

/**
 * Single-project job routes (mounted at /api/jobs).
 */
export function createJobRoutes(deps: IJobRoutesDeps): Router {
  return createJobRouteHandlers({
    getConfig: () => deps.getConfig(),
    getProjectDir: () => deps.projectDir,
    pathPrefix: '',
  });
}

/**
 * Project-scoped job routes for global mode (mounted at /api/projects/:id).
 */
export function createProjectJobRoutes(): Router {
  return createJobRouteHandlers({
    getConfig: (req) => req.projectConfig!,
    getProjectDir: (req) => req.projectDir!,
    pathPrefix: 'jobs/',
  });
}
