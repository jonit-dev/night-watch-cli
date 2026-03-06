/**
 * Roadmap UI helper utilities.
 *
 * Provides horizon/category mapping, pipeline stage calculation, and filtering
 * for the Roadmap page's horizon-based planning view.
 */

import React from 'react';
import {
  Clock,
  FileText,
  LayoutGrid,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import type { IRoadmapItem } from '../api';
import type { IBoardIssue, BoardColumnName } from '../api';

// ==================== Types ====================

export type CategoryLabel =
  | 'reliability'
  | 'quality'
  | 'product'
  | 'ux'
  | 'provider'
  | 'team'
  | 'platform'
  | 'intelligence'
  | 'ecosystem';

export type HorizonLabel = 'short-term' | 'medium-term' | 'long-term';

export type PipelineStage = 'pending' | 'sliced' | 'on-board' | 'active' | 'done';

export interface IItemMapping {
  horizon: HorizonLabel;
  category: CategoryLabel;
}

export interface IEnrichedRoadmapItem extends IRoadmapItem {
  mapping: IItemMapping | null;
  pipelineStage: PipelineStage;
  boardIssue: IBoardIssue | null;
}

// ==================== Category Colors ====================

export const CATEGORY_COLORS: Record<CategoryLabel, { bg: string; text: string }> = {
  reliability:   { bg: 'bg-rose-500/15',    text: 'text-rose-400'    },
  quality:       { bg: 'bg-amber-500/15',   text: 'text-amber-400'   },
  product:       { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  ux:            { bg: 'bg-cyan-500/15',    text: 'text-cyan-400'    },
  provider:      { bg: 'bg-blue-500/15',    text: 'text-blue-400'    },
  team:          { bg: 'bg-indigo-500/15',  text: 'text-indigo-400'  },
  platform:      { bg: 'bg-purple-500/15',  text: 'text-purple-400'  },
  intelligence:  { bg: 'bg-violet-500/15',  text: 'text-violet-400'  },
  ecosystem:     { bg: 'bg-pink-500/15',    text: 'text-pink-400'    },
};

// ==================== Horizon Labels ====================

export const HORIZON_LABELS: Record<HorizonLabel, string> = {
  'short-term':  'Short-term (0-6 wk)',
  'medium-term': 'Medium-term (6wk-4mo)',
  'long-term':   'Long-term (4-12mo)',
};

// ==================== Pipeline Stage Config ====================

export const PIPELINE_STAGES: PipelineStage[] = ['pending', 'sliced', 'on-board', 'active', 'done'];

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'neutral' | 'info';

export const PIPELINE_STAGE_CONFIG: Record<PipelineStage, {
  label: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: BadgeVariant;
}> = {
  pending:  { label: 'Pending',      color: 'text-slate-500',   icon: Clock,       badge: 'neutral' },
  sliced:   { label: 'PRD Created',  color: 'text-indigo-400',  icon: FileText,    badge: 'info'    },
  'on-board': { label: 'On Board',   color: 'text-blue-400',    icon: LayoutGrid,  badge: 'default' },
  active:   { label: 'Active',       color: 'text-amber-400',   icon: Zap,         badge: 'warning' },
  done:     { label: 'Done',         color: 'text-emerald-400', icon: CheckCircle2, badge: 'success' },
};

// ==================== Section to Horizon/Category Mapping ====================

interface ISectionMapping {
  pattern: RegExp;
  category: CategoryLabel;
  horizon: HorizonLabel;
}

const SECTION_MAPPINGS: ISectionMapping[] = [
  // Short-term (§1-3)
  { pattern: /§1.*Reliability.*correctness/i, category: 'reliability', horizon: 'short-term' },
  { pattern: /§2.*Quality.*developer/i,       category: 'quality',     horizon: 'short-term' },
  { pattern: /§3.*Product.*operators/i,       category: 'product',     horizon: 'short-term' },
  // Medium-term (§4-6)
  { pattern: /§4.*Unified.*operations/i,      category: 'ux',          horizon: 'medium-term' },
  { pattern: /§5.*Provider.*execution/i,      category: 'provider',    horizon: 'medium-term' },
  { pattern: /§6.*Team.*multi-project/i,      category: 'team',        horizon: 'medium-term' },
  // Long-term (§7-9)
  { pattern: /§7.*Platformization.*enterprise/i, category: 'platform',     horizon: 'long-term' },
  { pattern: /§8.*Intelligence.*autonomous/i,    category: 'intelligence', horizon: 'long-term' },
  { pattern: /§9.*Ecosystem.*adoption/i,         category: 'ecosystem',    horizon: 'long-term' },
  // Fallback patterns without section numbers
  { pattern: /Reliability.*correctness/i,     category: 'reliability', horizon: 'short-term' },
  { pattern: /Quality.*developer.*workflow/i, category: 'quality',     horizon: 'short-term' },
  { pattern: /Product.*completeness/i,        category: 'product',     horizon: 'short-term' },
  { pattern: /Unified.*operations/i,          category: 'ux',          horizon: 'medium-term' },
  { pattern: /Provider.*execution/i,          category: 'provider',    horizon: 'medium-term' },
  { pattern: /Team.*multi-project/i,          category: 'team',        horizon: 'medium-term' },
  { pattern: /Platformization.*enterprise/i,  category: 'platform',    horizon: 'long-term' },
  { pattern: /Intelligence.*autonomous/i,     category: 'intelligence', horizon: 'long-term' },
  { pattern: /Ecosystem.*adoption/i,          category: 'ecosystem',    horizon: 'long-term' },
  // Simple keyword patterns
  { pattern: /Reliability/i, category: 'reliability', horizon: 'short-term' },
  { pattern: /Quality/i,     category: 'quality',     horizon: 'short-term' },
  { pattern: /Product/i,     category: 'product',     horizon: 'short-term' },
  { pattern: /Unified/i,     category: 'ux',          horizon: 'medium-term' },
  { pattern: /Provider/i,    category: 'provider',    horizon: 'medium-term' },
  { pattern: /Team/i,        category: 'team',        horizon: 'medium-term' },
  { pattern: /Platform/i,    category: 'platform',    horizon: 'long-term' },
  { pattern: /Intelligence/i, category: 'intelligence', horizon: 'long-term' },
  { pattern: /Ecosystem/i,    category: 'ecosystem',    horizon: 'long-term' },
];

/**
 * Get the horizon and category for a roadmap item based on its section name.
 * Returns null if no mapping is found.
 */
export function getItemHorizonAndCategory(item: IRoadmapItem): IItemMapping | null {
  const section = item.section || '';
  for (const mapping of SECTION_MAPPINGS) {
    if (mapping.pattern.test(section)) {
      return { horizon: mapping.horizon, category: mapping.category };
    }
  }
  return null;
}

/**
 * Group roadmap items by horizon, then by category.
 * Items without a mapping go into an 'unmapped' bucket.
 */
export function groupItemsByHorizon(
  items: IEnrichedRoadmapItem[],
): Record<HorizonLabel | 'unmapped', Record<CategoryLabel | 'other', IEnrichedRoadmapItem[]>> {
  const result: Record<HorizonLabel | 'unmapped', Record<CategoryLabel | 'other', IEnrichedRoadmapItem[]>> = {
    'short-term':  {},
    'medium-term': {},
    'long-term':   {},
    unmapped:      {},
  };

  for (const item of items) {
    if (item.mapping) {
      const horizon = item.mapping.horizon;
      const category = item.mapping.category;
      if (!result[horizon][category]) {
        result[horizon][category] = [];
      }
      result[horizon][category].push(item);
    } else {
      if (!result.unmapped['other']) {
        result.unmapped['other'] = [];
      }
      result.unmapped['other'].push(item);
    }
  }

  return result;
}

/**
 * Get the basic pipeline stage for a roadmap item.
 * This is the simplified version used in Phase 1.
 */
export function getItemPipelineStage(item: IRoadmapItem): 'pending' | 'sliced' | 'done' {
  if (item.checked) return 'done';
  if (item.processed) return 'sliced';
  return 'pending';
}

// ==================== Phase 2: Board Linkage ====================

/**
 * Normalize a string for matching: lowercase, trim, remove special chars.
 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

/**
 * Match a roadmap item to a board issue by normalized title substring matching.
 */
export function matchItemToBoardIssue(
  item: IRoadmapItem,
  boardIssues: IBoardIssue[],
): IBoardIssue | null {
  const normalizedItemTitle = normalizeTitle(item.title);
  if (!normalizedItemTitle) return null;

  for (const issue of boardIssues) {
    const normalizedIssueTitle = normalizeTitle(issue.title);
    // Check if either title contains the other (handles both directions)
    if (normalizedIssueTitle.includes(normalizedItemTitle) || normalizedItemTitle.includes(normalizedIssueTitle)) {
      return issue;
    }
  }
  return null;
}

/**
 * Get the full pipeline stage combining roadmap item state and board issue status.
 */
export function getFullPipelineStage(
  item: IRoadmapItem,
  boardIssue: IBoardIssue | null,
): PipelineStage {
  // Checked items are done
  if (item.checked) return 'done';

  // Unprocessed items are pending
  if (!item.processed) return 'pending';

  // Processed but no board issue = sliced (PRD created)
  if (!boardIssue) return 'sliced';

  // Board issue exists - check column
  const column = boardIssue.column;
  if (!column) return 'sliced';

  switch (column) {
    case 'Draft':
      return 'on-board';
    case 'Ready':
    case 'In Progress':
    case 'Review':
      return 'active';
    case 'Done':
      return 'done';
    default:
      return 'sliced';
  }
}

/**
 * Get a summary of pipeline stage counts.
 */
export function getPipelineSummary(
  items: IEnrichedRoadmapItem[],
): Record<PipelineStage, number> {
  const summary: Record<PipelineStage, number> = {
    pending: 0,
    sliced: 0,
    'on-board': 0,
    active: 0,
    done: 0,
  };

  for (const item of items) {
    summary[item.pipelineStage]++;
  }

  return summary;
}

// ==================== Phase 3: Filtering ====================

export interface IRoadmapFilters {
  categories: Set<CategoryLabel>;
  horizons: Set<HorizonLabel>;
  stages: Set<PipelineStage>;
  search: string;
}

export const DEFAULT_FILTERS: IRoadmapFilters = {
  categories: new Set(),
  horizons: new Set(),
  stages: new Set(),
  search: '',
};

/**
 * Filter enriched roadmap items based on the provided filters.
 * Empty sets mean "no filter" (show all).
 */
export function filterItems(
  items: IEnrichedRoadmapItem[],
  filters: IRoadmapFilters,
): IEnrichedRoadmapItem[] {
  return items.filter(item => {
    // Category filter
    if (filters.categories.size > 0) {
      if (!item.mapping || !filters.categories.has(item.mapping.category)) {
        return false;
      }
    }

    // Horizon filter
    if (filters.horizons.size > 0) {
      if (!item.mapping || !filters.horizons.has(item.mapping.horizon)) {
        return false;
      }
    }

    // Stage filter
    if (filters.stages.size > 0) {
      if (!filters.stages.has(item.pipelineStage)) {
        return false;
      }
    }

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const titleMatch = item.title.toLowerCase().includes(searchLower);
      const descMatch = item.description?.toLowerCase().includes(searchLower) ?? false;
      if (!titleMatch && !descMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Check if an item is an audit finding based on its section name.
 */
export function isAuditFinding(item: IRoadmapItem): boolean {
  const section = item.section?.toLowerCase() || '';
  return section.includes('audit') || section.includes('finding');
}

/**
 * Enrich roadmap items with mapping, pipeline stage, and board issue data.
 */
export function enrichRoadmapItems(
  items: IRoadmapItem[],
  boardIssues: IBoardIssue[],
): IEnrichedRoadmapItem[] {
  return items.map(item => {
    const mapping = getItemHorizonAndCategory(item);
    const boardIssue = matchItemToBoardIssue(item, boardIssues);
    const pipelineStage = getFullPipelineStage(item, boardIssue);

    return {
      ...item,
      mapping,
      pipelineStage,
      boardIssue,
    };
  });
}
