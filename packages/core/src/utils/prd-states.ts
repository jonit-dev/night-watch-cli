/**
 * PRD state persistence for Night Watch CLI
 * Tracks pending-review (and future) PRD states via the SQLite repository layer.
 */

import { getRepositories } from "../storage/repositories/index.js";

export interface IPrdStateEntry {
  status: "pending-review";
  branch: string;
  timestamp: number;
}

export type IPrdStates = Record<string, Record<string, IPrdStateEntry>>;

export function readPrdStates(): IPrdStates {
  const { prdState } = getRepositories();
  return prdState.readAll();
}

export function getPrdStatesForProject(projectDir: string): Record<string, IPrdStateEntry> {
  const { prdState } = getRepositories();
  return prdState.getAll(projectDir);
}

export function writePrdState(
  projectDir: string,
  prdName: string,
  entry: IPrdStateEntry
): void {
  const { prdState } = getRepositories();
  prdState.set(projectDir, prdName, entry);
}

export function clearPrdState(projectDir: string, prdName: string): void {
  const { prdState } = getRepositories();
  prdState.delete(projectDir, prdName);
}

export function listPrdStatesByStatus(
  projectDir: string,
  status: "pending-review"
): string[] {
  const states = getPrdStatesForProject(projectDir);
  return Object.entries(states)
    .filter(([, entry]) => entry.status === status)
    .map(([prdName]) => prdName);
}
