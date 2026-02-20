/**
 * Label taxonomy for Night Watch board issues.
 *
 * These labels align with ROADMAP.md themes and provide priority/horizon classification.
 */

// ---------------------------------------------------------------------------
// Priority Labels
// ---------------------------------------------------------------------------

export const PRIORITY_LABELS = ["P0", "P1", "P2"] as const;
export type PriorityLabel = (typeof PRIORITY_LABELS)[number];

export const PRIORITY_LABEL_INFO: Record<PriorityLabel, { name: string; description: string }> = {
  P0: { name: "P0", description: "Critical - requires immediate attention" },
  P1: { name: "P1", description: "High - important, should be prioritized" },
  P2: { name: "P2", description: "Normal - standard priority" },
};

// ---------------------------------------------------------------------------
// Category Labels (mapped to ROADMAP.md themes)
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS = [
  "reliability", // Roadmap §1 — error handling, logs, claim files
  "quality", // Roadmap §2 — CI, coverage, shellcheck
  "product", // Roadmap §3 — history cmd, doctor, scheduling
  "ux", // Roadmap §4 — PRD lifecycle, real-time stream, logs UX
  "provider", // Roadmap §5 — Gemini, cost tracking, TS strategy
  "team", // Roadmap §6 — global mode, profiles, collaboration
  "platform", // Roadmap §7 — policy engine, auth, audit
  "intelligence", // Roadmap §8 — PRD decomposition, post-run review
  "ecosystem", // Roadmap §9 — GitHub Action, SLOs, playbooks
] as const;

export type CategoryLabel = (typeof CATEGORY_LABELS)[number];

export const CATEGORY_LABEL_INFO: Record<CategoryLabel, { name: string; description: string }> = {
  reliability: {
    name: "reliability",
    description: "Reliability and correctness hardening (Roadmap §1)",
  },
  quality: {
    name: "quality",
    description: "Quality gates and developer workflow (Roadmap §2)",
  },
  product: {
    name: "product",
    description: "Product completeness for core operators (Roadmap §3)",
  },
  ux: {
    name: "ux",
    description: "Unified operations experience (Roadmap §4)",
  },
  provider: {
    name: "provider",
    description: "Provider and execution platform expansion (Roadmap §5)",
  },
  team: {
    name: "team",
    description: "Team and multi-project ergonomics (Roadmap §6)",
  },
  platform: {
    name: "platform",
    description: "Platformization and enterprise readiness (Roadmap §7)",
  },
  intelligence: {
    name: "intelligence",
    description: "Intelligence and autonomous planning (Roadmap §8)",
  },
  ecosystem: {
    name: "ecosystem",
    description: "Ecosystem and adoption (Roadmap §9)",
  },
};

// ---------------------------------------------------------------------------
// Horizon Labels
// ---------------------------------------------------------------------------

export const HORIZON_LABELS = ["short-term", "medium-term", "long-term"] as const;
export type HorizonLabel = (typeof HORIZON_LABELS)[number];

export const HORIZON_LABEL_INFO: Record<HorizonLabel, { name: string; description: string }> = {
  "short-term": { name: "short-term", description: "0-6 weeks delivery window" },
  "medium-term": { name: "medium-term", description: "6 weeks - 4 months delivery window" },
  "long-term": { name: "long-term", description: "4-12 months delivery window" },
};

// ---------------------------------------------------------------------------
// Combined label definitions for setup
// ---------------------------------------------------------------------------

export interface ILabelDefinition {
  name: string;
  description: string;
  color: string;
}

/**
 * All Night Watch labels with their GitHub color assignments.
 */
export const NIGHT_WATCH_LABELS: ILabelDefinition[] = [
  // Priority labels
  ...PRIORITY_LABELS.map(
    (p): ILabelDefinition => ({
      name: PRIORITY_LABEL_INFO[p].name,
      description: PRIORITY_LABEL_INFO[p].description,
      color: p === "P0" ? "b60205" : p === "P1" ? "d93f0b" : "fbca04",
    })
  ),
  // Category labels
  ...CATEGORY_LABELS.map(
    (c): ILabelDefinition => ({
      name: CATEGORY_LABEL_INFO[c].name,
      description: CATEGORY_LABEL_INFO[c].description,
      color: "1d76db",
    })
  ),
  // Horizon labels
  ...HORIZON_LABELS.map(
    (h): ILabelDefinition => ({
      name: HORIZON_LABEL_INFO[h].name,
      description: HORIZON_LABEL_INFO[h].description,
      color: "5319e7",
    })
  ),
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function isValidPriority(value: string): value is PriorityLabel {
  return PRIORITY_LABELS.includes(value as PriorityLabel);
}

export function isValidCategory(value: string): value is CategoryLabel {
  return CATEGORY_LABELS.includes(value as CategoryLabel);
}

export function isValidHorizon(value: string): value is HorizonLabel {
  return HORIZON_LABELS.includes(value as HorizonLabel);
}

// ---------------------------------------------------------------------------
// Label extraction from issue
// ---------------------------------------------------------------------------

import type { IBoardIssue } from "./types.js";

/**
 * Extract priority label from issue labels, if present.
 */
export function extractPriority(issue: IBoardIssue): PriorityLabel | null {
  for (const label of issue.labels) {
    if (isValidPriority(label)) {
      return label;
    }
  }
  return null;
}

/**
 * Extract category label from issue labels, if present.
 */
export function extractCategory(issue: IBoardIssue): CategoryLabel | null {
  for (const label of issue.labels) {
    if (isValidCategory(label)) {
      return label;
    }
  }
  return null;
}

/**
 * Extract horizon label from issue labels, if present.
 */
export function extractHorizon(issue: IBoardIssue): HorizonLabel | null {
  for (const label of issue.labels) {
    if (isValidHorizon(label)) {
      return label;
    }
  }
  return null;
}

/**
 * Get display name for priority (with description).
 */
export function getPriorityDisplayName(priority: PriorityLabel | null): string {
  if (!priority) return "";
  const info = PRIORITY_LABEL_INFO[priority];
  return `${info.name} — ${info.description.split(" — ")[0]}`;
}

/**
 * Sort issues by priority (P0 > P1 > P2 > unlabeled).
 */
export function sortByPriority<T extends { labels: string[] }>(issues: T[]): T[] {
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  return [...issues].sort((a, b) => {
    const aPriority = a.labels.find((l) => l in priorityOrder) as string | undefined;
    const bPriority = b.labels.find((l) => l in priorityOrder) as string | undefined;
    const aOrder = aPriority ? priorityOrder[aPriority] : 99;
    const bOrder = bPriority ? priorityOrder[bPriority] : 99;
    return aOrder - bOrder;
  });
}
