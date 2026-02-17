/**
 * Roadmap Scanner for Night Watch CLI
 * Scans ROADMAP.md files and generates PRD skeleton files
 */

import * as fs from "fs";
import * as path from "path";
import { INightWatchConfig } from "../types.js";
import { getNextPrdNumber, slugify } from "../commands/prd.js";
import { renderPrdTemplate } from "../templates/prd-template.js";
import { IRoadmapItem, parseRoadmap } from "./roadmap-parser.js";
import {
  IRoadmapStateItem,
  isItemProcessed,
  loadRoadmapState,
  markItemProcessed,
  saveRoadmapState,
} from "./roadmap-state.js";

/**
 * Status of the roadmap scanner
 */
export interface IRoadmapStatus {
  /** Whether ROADMAP.md file was found */
  found: boolean;
  /** Whether the scanner is enabled in config */
  enabled: boolean;
  /** Total number of items in roadmap */
  totalItems: number;
  /** Number of items that have been processed */
  processedItems: number;
  /** Number of items pending processing */
  pendingItems: number;
  /** Current status of the scanner */
  status: "idle" | "scanning" | "complete" | "disabled" | "no-roadmap";
  /** All roadmap items with processing status */
  items: Array<IRoadmapItem & { processed: boolean; prdFile?: string }>;
}

/**
 * Result of a roadmap scan operation
 */
export interface IScanResult {
  /** List of PRD files created */
  created: string[];
  /** List of items skipped (already processed or checked) */
  skipped: string[];
  /** List of errors encountered */
  errors: string[];
}

/**
 * Get the current status of the roadmap scanner
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The roadmap scanner status
 */
export function getRoadmapStatus(
  projectDir: string,
  config: INightWatchConfig
): IRoadmapStatus {
  const roadmapPath = path.join(projectDir, config.roadmapScanner.roadmapPath);

  // Check if enabled
  if (!config.roadmapScanner.enabled) {
    return {
      found: false,
      enabled: false,
      totalItems: 0,
      processedItems: 0,
      pendingItems: 0,
      status: "disabled",
      items: [],
    };
  }

  // Check if roadmap file exists
  if (!fs.existsSync(roadmapPath)) {
    return {
      found: false,
      enabled: true,
      totalItems: 0,
      processedItems: 0,
      pendingItems: 0,
      status: "no-roadmap",
      items: [],
    };
  }

  // Parse roadmap
  const content = fs.readFileSync(roadmapPath, "utf-8");
  const items = parseRoadmap(content);

  // Load state
  const prdDir = path.join(projectDir, config.prdDir);
  const state = loadRoadmapState(prdDir);

  // Scan existing PRD files for title-based duplicate detection
  const existingPrdSlugs = scanExistingPrdSlugs(prdDir);

  // Build status items
  const statusItems = items.map((item) => {
    const processed = isItemProcessed(state, item.hash);
    const stateItem = state.items[item.hash];

    // Also check for duplicates by title match
    const itemSlug = slugify(item.title);
    const isDuplicateByTitle = existingPrdSlugs.has(itemSlug) && !processed;

    return {
      ...item,
      processed: processed || isDuplicateByTitle,
      prdFile: stateItem?.prdFile,
    };
  });

  // Count processed and pending
  const processedItems = statusItems.filter((item) => item.processed).length;
  const pendingItems = statusItems.filter(
    (item) => !item.processed && !item.checked
  ).length;

  // Determine status
  let status: IRoadmapStatus["status"];
  if (pendingItems === 0 && statusItems.length > 0) {
    status = "complete";
  } else {
    status = "idle";
  }

  return {
    found: true,
    enabled: true,
    totalItems: items.length,
    processedItems,
    pendingItems,
    status,
    items: statusItems,
  };
}

/**
 * Scan the roadmap and create PRD files for unprocessed items
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The scan result with created, skipped, and error lists
 */
export function scanRoadmap(
  projectDir: string,
  config: INightWatchConfig
): IScanResult {
  const result: IScanResult = {
    created: [],
    skipped: [],
    errors: [],
  };

  // Check if enabled
  if (!config.roadmapScanner.enabled) {
    return result;
  }

  const roadmapPath = path.join(projectDir, config.roadmapScanner.roadmapPath);

  // Check if roadmap file exists
  if (!fs.existsSync(roadmapPath)) {
    return result;
  }

  // Parse roadmap
  const content = fs.readFileSync(roadmapPath, "utf-8");
  const items = parseRoadmap(content);

  if (items.length === 0) {
    return result;
  }

  // Setup PRD directory
  const prdDir = path.join(projectDir, config.prdDir);
  if (!fs.existsSync(prdDir)) {
    fs.mkdirSync(prdDir, { recursive: true });
  }

  // Load state
  let state = loadRoadmapState(prdDir);

  // Scan existing PRD files for title-based duplicate detection
  const existingPrdSlugs = scanExistingPrdSlugs(prdDir);

  // Process each item
  for (const item of items) {
    // Skip checked items (completed in roadmap)
    if (item.checked) {
      result.skipped.push(`${item.title} (checked)`);
      continue;
    }

    // Skip already processed items
    if (isItemProcessed(state, item.hash)) {
      result.skipped.push(`${item.title} (processed)`);
      continue;
    }

    // Skip items that have a PRD with matching title
    const itemSlug = slugify(item.title);
    if (existingPrdSlugs.has(itemSlug)) {
      result.skipped.push(`${item.title} (duplicate by title)`);
      continue;
    }

    try {
      // Generate PRD file
      const prdFile = createPrdFromItem(prdDir, item);

      // Update state
      const stateItem: IRoadmapStateItem = {
        title: item.title,
        prdFile,
        createdAt: new Date().toISOString(),
      };
      state = markItemProcessed(state, item.hash, stateItem);

      // Add to existing slugs to prevent duplicates in same scan
      existingPrdSlugs.add(itemSlug);

      result.created.push(prdFile);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`${item.title}: ${errorMessage}`);
    }
  }

  // Save state
  saveRoadmapState(prdDir, state);

  return result;
}

/**
 * Check if there are new (unprocessed) items in the roadmap
 */
export function hasNewItems(
  projectDir: string,
  config: INightWatchConfig
): boolean {
  const status = getRoadmapStatus(projectDir, config);
  return status.pendingItems > 0;
}

/**
 * Scan existing PRD files and extract their slugs for duplicate detection
 */
function scanExistingPrdSlugs(prdDir: string): Set<string> {
  const slugs = new Set<string>();

  if (!fs.existsSync(prdDir)) {
    return slugs;
  }

  const files = fs.readdirSync(prdDir);
  for (const file of files) {
    // Skip non-markdown files and special files
    if (!file.endsWith(".md") || file === "NIGHT-WATCH-SUMMARY.md") {
      continue;
    }

    // Extract slug from filename (e.g., "01-feature-name.md" -> "feature-name")
    const match = file.match(/^\d+-(.+)\.md$/);
    if (match) {
      slugs.add(match[1]);
    } else {
      // Handle files without number prefix
      const slugMatch = file.match(/^(.+)\.md$/);
      if (slugMatch) {
        slugs.add(slugMatch[1]);
      }
    }
  }

  return slugs;
}

/**
 * Create a PRD file from a roadmap item
 *
 * @param prdDir - The PRD directory
 * @param item - The roadmap item
 * @returns The filename of the created PRD
 */
function createPrdFromItem(prdDir: string, item: IRoadmapItem): string {
  // Get next PRD number
  const nextNum = getNextPrdNumber(prdDir);
  const padded = String(nextNum).padStart(2, "0");

  // Generate filename
  const slug = slugify(item.title);
  const filename = `${padded}-${slug}.md`;
  const filePath = path.join(prdDir, filename);

  // Render PRD template
  const prdContent = renderPrdTemplate({
    title: item.title,
    dependsOn: [],
    complexityScore: 5,
    complexityLevel: "MEDIUM",
    complexityBreakdown: [],
    phaseCount: 3,
  });

  // Prepend roadmap context comment
  const roadmapContext = `<!-- Roadmap Context:
Section: ${item.section}
Description: ${item.description}
-->

`;

  const fullContent = roadmapContext + prdContent;

  // Write file
  fs.writeFileSync(filePath, fullContent, "utf-8");

  return filename;
}
