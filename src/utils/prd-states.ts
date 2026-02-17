/**
 * PRD state persistence for Night Watch CLI
 * Tracks pending-review (and future) PRD states in ~/.night-watch/prd-states.json
 * so PRD files do not need to move directories.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GLOBAL_CONFIG_DIR, PRD_STATES_FILE_NAME } from "../constants.js";

export interface IPrdStateEntry {
  status: "pending-review";
  branch: string;
  timestamp: number;
}

export type IPrdStates = Record<string, Record<string, IPrdStateEntry>>;

function prdStatesPath(): string {
  return path.join(os.homedir(), GLOBAL_CONFIG_DIR, PRD_STATES_FILE_NAME);
}

export function readPrdStates(): IPrdStates {
  const filePath = prdStatesPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as IPrdStates;
  } catch {
    return {};
  }
}

export function getPrdStatesForProject(projectDir: string): Record<string, IPrdStateEntry> {
  const all = readPrdStates();
  return all[projectDir] ?? {};
}

export function writePrdState(
  projectDir: string,
  prdName: string,
  entry: IPrdStateEntry
): void {
  const filePath = prdStatesPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const all = readPrdStates();
  if (!all[projectDir]) {
    all[projectDir] = {};
  }
  all[projectDir][prdName] = entry;
  fs.writeFileSync(filePath, JSON.stringify(all, null, 2), "utf-8");
}

export function clearPrdState(projectDir: string, prdName: string): void {
  const filePath = prdStatesPath();
  if (!fs.existsSync(filePath)) return;

  const all = readPrdStates();
  if (!all[projectDir]) return;

  delete all[projectDir][prdName];
  if (Object.keys(all[projectDir]).length === 0) {
    delete all[projectDir];
  }
  fs.writeFileSync(filePath, JSON.stringify(all, null, 2), "utf-8");
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
