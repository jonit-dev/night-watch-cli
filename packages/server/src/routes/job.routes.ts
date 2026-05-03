/**
 * Signed job dispatch routes: /api/jobs/:id/run.
 */

import { spawn } from 'child_process';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

import { Request, Response, Router } from 'express';

import {
  INightWatchConfig,
  IWebhookTriggerGithubRule,
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

interface IIgnoredJobDispatchResponse {
  accepted: false;
  ignored: true;
  reason: string;
}

interface IGithubWebhookHeaders {
  event: string | undefined;
  delivery: string | undefined;
  signature: string | undefined;
}

interface IGithubWebhookContext {
  event: string;
  delivery?: string;
  action?: string;
  branch?: string;
  prNumber?: string;
  failed: boolean;
}

interface IGithubWebhookMatch {
  rule: IWebhookTriggerGithubRule;
  context: IGithubWebhookContext;
}

interface IObjectRecord {
  [key: string]: unknown;
}

const SUPPORTED_GITHUB_EVENTS = [
  'workflow_run',
  'check_suite',
  'pull_request',
  'repository_dispatch',
] as const;

function isSupportedGithubEvent(value: string): boolean {
  return SUPPORTED_GITHUB_EVENTS.some((event) => event === value);
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

function getGithubWebhookHeaders(req: Request): IGithubWebhookHeaders {
  return {
    event: req.get('X-GitHub-Event'),
    delivery: req.get('X-GitHub-Delivery'),
    signature: req.get('X-Hub-Signature-256'),
  };
}

function hasGithubHeaders(headers: IGithubWebhookHeaders): boolean {
  return Boolean(headers.event && headers.signature);
}

function isObjectRecord(value: unknown): value is IObjectRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readObject(value: unknown): IObjectRecord | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumberString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return readString(value);
}

function readFirstPullRequestNumber(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const pr = readObject(item);
    const number = readNumberString(pr?.number);
    if (number) return number;
  }
  return undefined;
}

function isFailureConclusion(value: unknown): boolean {
  const conclusion = readString(value)?.toLowerCase();
  if (!conclusion) return false;
  return !['success', 'neutral', 'skipped'].includes(conclusion);
}

function parseJsonBody(rawBody: Buffer): unknown {
  if (rawBody.length === 0) {
    return {};
  }
  return JSON.parse(rawBody.toString('utf-8'));
}

function buildGithubContext(
  headers: IGithubWebhookHeaders,
  payload: IObjectRecord,
): IGithubWebhookContext | undefined {
  if (!headers.event || !isSupportedGithubEvent(headers.event)) {
    return undefined;
  }

  const context: IGithubWebhookContext = {
    event: headers.event,
    delivery: headers.delivery,
    action: readString(payload.action),
    failed: false,
  };

  switch (headers.event) {
    case 'workflow_run': {
      const workflowRun = readObject(payload.workflow_run);
      context.branch = readString(workflowRun?.head_branch);
      context.prNumber = readFirstPullRequestNumber(workflowRun?.pull_requests);
      context.failed = isFailureConclusion(workflowRun?.conclusion);
      break;
    }
    case 'check_suite': {
      const checkSuite = readObject(payload.check_suite);
      context.branch = readString(checkSuite?.head_branch);
      context.prNumber = readFirstPullRequestNumber(checkSuite?.pull_requests);
      context.failed = isFailureConclusion(checkSuite?.conclusion);
      break;
    }
    case 'pull_request': {
      const pullRequest = readObject(payload.pull_request);
      const head = readObject(pullRequest?.head);
      context.branch = readString(head?.ref);
      context.prNumber = readNumberString(payload.number) ?? readNumberString(pullRequest?.number);
      break;
    }
    case 'repository_dispatch': {
      const clientPayload = readObject(payload.client_payload);
      context.action = readString(payload.action) ?? readString(payload.event_type);
      context.branch =
        readString(clientPayload?.branch) ??
        readString(clientPayload?.ref) ??
        readString(payload.ref) ??
        readString(payload.branch);
      context.prNumber =
        readNumberString(clientPayload?.pr_number) ??
        readNumberString(clientPayload?.pull_request_number) ??
        readNumberString(payload.pr_number);
      context.failed =
        readString(clientPayload?.status)?.toLowerCase() === 'failure' ||
        readString(clientPayload?.conclusion)?.toLowerCase() === 'failure';
      break;
    }
  }

  return context;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const wildcarded = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${wildcarded}$`);
}

function matchesBranchPattern(
  branch: string | undefined,
  branchPatterns: string[] | undefined,
): boolean {
  if (!branchPatterns || branchPatterns.length === 0) return true;
  if (!branch) return false;
  return branchPatterns.some((pattern) => globToRegExp(pattern).test(branch));
}

function findGithubWebhookMatch(
  config: INightWatchConfig,
  headers: IGithubWebhookHeaders,
  payload: IObjectRecord,
): IGithubWebhookMatch | undefined {
  const context = buildGithubContext(headers, payload);
  if (!context) return undefined;
  if (config.webhookTriggers.github.events.length > 0) {
    const eventAllowed = config.webhookTriggers.github.events.includes(context.event);
    if (!eventAllowed) return undefined;
  }

  const rule = config.webhookTriggers.github.rules.find((candidate) => {
    if (candidate.event !== context.event) return false;
    if (candidate.action && candidate.action !== context.action) return false;
    if (candidate.onlyOnFailure && !context.failed) return false;
    return matchesBranchPattern(context.branch, candidate.branchPatterns);
  });

  if (!rule) return undefined;
  return { rule, context };
}

function buildGithubWebhookEnv(context: IGithubWebhookContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NW_WEBHOOK_SOURCE: 'github',
    NW_WEBHOOK_EVENT: context.event,
  };
  if (context.delivery) {
    env.NW_WEBHOOK_DELIVERY = context.delivery;
  }
  if (context.prNumber) {
    env.NW_WEBHOOK_PR_NUMBER = context.prNumber;
  }
  if (context.branch) {
    env.NW_WEBHOOK_BRANCH = context.branch;
  }
  return env;
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
      const requestedJobDef = JOB_REGISTRY.find((job) => job.id === requestedJobId);
      if (!requestedJobDef) {
        res.status(404).json({ error: 'Unknown job id' });
        return;
      }

      if (!webhookConfig.allowedJobIds.includes(requestedJobDef.id)) {
        res.status(403).json({ error: 'Job is not allowed for webhook dispatch' });
        return;
      }

      const githubHeaders = getGithubWebhookHeaders(req);
      let githubEnv: NodeJS.ProcessEnv = {};
      let matchedGithubJobId: JobType | undefined;
      if (hasGithubHeaders(githubHeaders) && webhookConfig.github.enabled) {
        let payload: unknown;
        try {
          payload = parseJsonBody(rawBody);
        } catch {
          res.status(400).json({ error: 'Malformed JSON payload' });
          return;
        }

        const match = findGithubWebhookMatch(config, githubHeaders, readObject(payload) ?? {});
        if (!match) {
          const response: IIgnoredJobDispatchResponse = {
            accepted: false,
            ignored: true,
            reason: 'No matching GitHub webhook rule',
          };
          res.status(202).json(response);
          return;
        }

        matchedGithubJobId = match.rule.jobId;
        githubEnv = buildGithubWebhookEnv(match.context);
      }

      const dispatchJobId = matchedGithubJobId ?? requestedJobDef.id;
      const jobDef = JOB_REGISTRY.find((job) => job.id === dispatchJobId);
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
          ...githubEnv,
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
