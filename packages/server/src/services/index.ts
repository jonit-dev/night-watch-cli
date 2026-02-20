/**
 * Service layer barrel export.
 * All server-layer injectable services are re-exported from here.
 */

export { NotificationService } from './notification.service.js';
export type { INotificationContext } from './notification.service.js';

export { StatusService } from './status.service.js';
export type { IStatusSnapshot, IPrdInfo, IPrInfo, ILogInfo, IProcessInfo } from './status.service.js';

export { RoadmapService } from './roadmap.service.js';
export type { IRoadmapStatus, IScanResult, ISliceResult } from './roadmap.service.js';
