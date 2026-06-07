import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const TELEMETRY_PATH = '/api/telemetry/web';

export type WebTelemetryEventName =
  | 'web_app_opened'
  | 'web_route_viewed'
  | 'web_ui_action'
  | 'web_api_action';

export type SafeRouteName =
  | 'dashboard'
  | 'analytics'
  | 'prs'
  | 'board'
  | 'scheduling'
  | 'logs'
  | 'roadmap'
  | 'settings'
  | 'unknown';

export type WebTelemetryProperties = {
  routeName?: SafeRouteName;
  uiArea?:
    | 'app'
    | 'navigation'
    | 'dashboard'
    | 'project_selector'
    | 'jobs'
    | 'schedules'
    | 'settings'
    | 'feedback'
    | 'logs'
    | 'queue'
    | 'board'
    | 'roadmap'
    | 'prs';
  action?:
    | 'open'
    | 'view'
    | 'refresh'
    | 'select'
    | 'trigger'
    | 'pause'
    | 'resume'
    | 'cancel'
    | 'clear'
    | 'save'
    | 'toggle'
    | 'create'
    | 'move'
    | 'close'
    | 'filter'
    | 'follow'
    | 'unfollow'
    | 'retry'
    | 'remove';
  resource?:
    | 'app'
    | 'route'
    | 'project'
    | 'dashboard'
    | 'job'
    | 'schedule'
    | 'settings'
    | 'feedback'
    | 'augmentation'
    | 'logs'
    | 'queue'
    | 'board_issue'
    | 'roadmap'
    | 'prs'
    | 'config'
    | 'cron'
    | 'lock';
  result?: 'success' | 'failure' | 'accepted' | 'rejected' | 'partial' | 'unknown';
  statusCategory?: 'success' | 'failure' | 'warning' | 'empty' | 'disabled' | 'not_configured' | 'unknown';
  success?: boolean;
  failure?: boolean;
  enabled?: boolean;
  globalMode?: boolean;
  durationMs?: number;
  projectCount?: number;
  selectedProjectIndex?: number;
  itemCount?: number;
  columnCount?: number;
  pendingCount?: number;
  runningCount?: number;
  jobType?: string;
};

const ROUTES: Array<[RegExp, SafeRouteName]> = [
  [/^\/$/, 'dashboard'],
  [/^\/analytics$/, 'analytics'],
  [/^\/prs$/, 'prs'],
  [/^\/board$/, 'board'],
  [/^\/scheduling$/, 'scheduling'],
  [/^\/logs$/, 'logs'],
  [/^\/roadmap$/, 'roadmap'],
  [/^\/settings$/, 'settings'],
];

export function getSafeRouteName(pathname: string): SafeRouteName {
  return ROUTES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'unknown';
}

export function trackWebTelemetry(
  eventName: WebTelemetryEventName,
  properties: WebTelemetryProperties = {},
): void {
  const payload = JSON.stringify({ eventName, properties });

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon(
        TELEMETRY_PATH,
        new Blob([payload], { type: 'application/json' }),
      );
      if (sent) return;
    }

    void fetch(TELEMETRY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Telemetry must never interrupt the UI.
    });
  } catch {
    // Telemetry must never interrupt the UI.
  }
}

export function trackWebApiOutcome(
  resource: NonNullable<WebTelemetryProperties['resource']>,
  action: NonNullable<WebTelemetryProperties['action']>,
  startedAt: number,
  success: boolean,
  extra: WebTelemetryProperties = {},
): void {
  trackWebTelemetry('web_api_action', {
    ...extra,
    resource,
    action,
    result: success ? 'success' : 'failure',
    success,
    failure: !success,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  });
}

export function WebTelemetryRouteTracker(): null {
  const location = useLocation();
  const trackedOpenRef = useRef(false);

  useEffect(() => {
    if (trackedOpenRef.current) return;
    trackedOpenRef.current = true;
    trackWebTelemetry('web_app_opened', {
      uiArea: 'app',
      action: 'open',
      resource: 'app',
      routeName: getSafeRouteName(location.pathname),
    });
  }, [location.pathname]);

  useEffect(() => {
    trackWebTelemetry('web_route_viewed', {
      uiArea: 'navigation',
      action: 'view',
      resource: 'route',
      routeName: getSafeRouteName(location.pathname),
    });
  }, [location.pathname]);

  return null;
}
