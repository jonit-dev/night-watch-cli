/**
 * Test DI container utilities.
 *
 * Provides a factory that creates a child container with mock/stub overrides
 * for use in unit tests. Each test gets a fresh child container so tests
 * remain isolated without resetting the global container.
 *
 * Usage:
 *   const c = createTestContainer({ notificationService: mockNotificationService });
 *   const svc = c.resolve(NotificationService);
 */

import 'reflect-metadata';

import { container, DependencyContainer } from 'tsyringe';

import type { IAgentPersonaRepository } from '@/storage/repositories/interfaces.js';
import { NotificationService } from '@/server/services/notification.service.js';
import { StatusService } from '@/server/services/status.service.js';
import { RoadmapService } from '@/server/services/roadmap.service.js';

export interface ITestContainerOverrides {
  /** Override the IAgentPersonaRepository binding */
  agentPersonaRepo?: IAgentPersonaRepository;
  /** Override NotificationService */
  notificationService?: NotificationService;
  /** Override StatusService */
  statusService?: StatusService;
  /** Override RoadmapService */
  roadmapService?: RoadmapService;
}

/**
 * Create a child DI container suitable for unit tests.
 *
 * The child container inherits all registrations from the global container but
 * allows per-test overrides via the `overrides` parameter. Pass mock/stub
 * instances to replace real implementations.
 *
 * @param overrides  Optional map of mock instances to register in the child container.
 * @returns A DependencyContainer configured for testing.
 */
export function createTestContainer(
  overrides: ITestContainerOverrides = {},
): DependencyContainer {
  const child = container.createChildContainer();

  if (overrides.notificationService) {
    child.registerInstance(NotificationService, overrides.notificationService);
  }
  if (overrides.statusService) {
    child.registerInstance(StatusService, overrides.statusService);
  }
  if (overrides.roadmapService) {
    child.registerInstance(RoadmapService, overrides.roadmapService);
  }

  return child;
}
