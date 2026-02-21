/**
 * RoadmapService — injectable wrapper around roadmap-scanner utilities.
 *
 * Provides all roadmap scanning and slicing operations as a testable service class.
 * The original utils/roadmap-scanner.ts functions continue to work as-is.
 */

import { injectable } from 'tsyringe';

import {
  INightWatchConfig,
  IRoadmapItem,
  IRoadmapStatus,
  IScanResult,
  ISliceResult,
  getRoadmapStatus,
  hasNewItems,
  scanRoadmap,
  sliceNextItem,
  sliceRoadmapItem,
} from '@night-watch/core';

export type { IRoadmapStatus, IScanResult, ISliceResult };

@injectable()
export class RoadmapService {
  /**
   * Get the current status of the roadmap scanner (item counts, processed state, etc.).
   */
  getStatus(projectDir: string, config: INightWatchConfig): IRoadmapStatus {
    return getRoadmapStatus(projectDir, config);
  }

  /**
   * Scan the roadmap and slice ONE unprocessed item into a PRD file.
   * Returns created/skipped/error lists.
   */
  async scan(projectDir: string, config: INightWatchConfig): Promise<IScanResult> {
    return scanRoadmap(projectDir, config);
  }

  /**
   * Slice the next unprocessed roadmap item.
   */
  async sliceNext(projectDir: string, config: INightWatchConfig): Promise<ISliceResult> {
    return sliceNextItem(projectDir, config);
  }

  /**
   * Slice a specific roadmap item into a PRD file.
   */
  async sliceItem(
    projectDir: string,
    prdDir: string,
    item: IRoadmapItem,
    config: INightWatchConfig,
  ): Promise<ISliceResult> {
    return sliceRoadmapItem(projectDir, prdDir, item, config);
  }

  /**
   * Returns true when there are unprocessed items in the roadmap.
   */
  hasNewItems(projectDir: string, config: INightWatchConfig): boolean {
    return hasNewItems(projectDir, config);
  }
}
