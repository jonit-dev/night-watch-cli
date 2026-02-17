/**
 * Tests for Roadmap Scanner
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getRoadmapStatus, scanRoadmap } from "../utils/roadmap-scanner.js";
import { INightWatchConfig } from "../types.js";
import { loadRoadmapState, getStateFilePath } from "../utils/roadmap-state.js";

describe("roadmap-scanner", () => {
  let tempDir: string;
  let prdDir: string;
  let roadmapPath: string;

  const defaultConfig: INightWatchConfig = {
    defaultBranch: "",
    prdDir: "docs/PRDs/night-watch",
    maxRuntime: 7200,
    reviewerMaxRuntime: 3600,
    branchPrefix: "night-watch",
    branchPatterns: ["feat/", "night-watch/"],
    minReviewScore: 80,
    maxLogSize: 524288,
    cronSchedule: "0 0-21 * * *",
    reviewerSchedule: "0 0,3,6,9,12,15,18,21 * * *",
    provider: "claude",
    reviewerEnabled: true,
    providerEnv: {},
    notifications: { webhooks: [] },
    prdPriority: [],
    roadmapScanner: {
      enabled: true,
      roadmapPath: "ROADMAP.md",
      autoScanInterval: 300,
    },
  };

  const disabledConfig: INightWatchConfig = {
    ...defaultConfig,
    roadmapScanner: {
      ...defaultConfig.roadmapScanner,
      enabled: false,
    },
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-scanner-test-"));
    prdDir = path.join(tempDir, "docs/PRDs/night-watch");
    roadmapPath = path.join(tempDir, "ROADMAP.md");

    // Create PRD directory
    fs.mkdirSync(prdDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getRoadmapStatus", () => {
    it("should return no-roadmap status when file missing", () => {
      // Don't create ROADMAP.md
      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.found).toBe(false);
      expect(status.status).toBe("no-roadmap");
      expect(status.totalItems).toBe(0);
    });

    it("should return disabled status when scanner disabled", () => {
      // Create ROADMAP.md
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Item 1\n`);

      const config = {
        ...disabledConfig,
        prdDir: path.relative(tempDir, prdDir),
      };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.enabled).toBe(false);
      expect(status.status).toBe("disabled");
    });

    it("should return complete when all items processed", () => {
      // Create ROADMAP.md
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Item 1\n`);

      // Create state with processed item
      const statePath = getStateFilePath(prdDir);
      const state = {
        version: 1,
        lastScan: "",
        items: {
          acadda60: {
            // hash for "item 1"
            title: "Item 1",
            prdFile: "01-item-1.md",
            createdAt: new Date().toISOString(),
          },
        },
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.status).toBe("complete");
      expect(status.processedItems).toBe(1);
      expect(status.pendingItems).toBe(0);
    });

    it("should return correct counts for mixed items", () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] Item 1
- [x] Item 2 (checked)
- [ ] Item 3
`
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.totalItems).toBe(3);
      expect(status.processedItems).toBe(0);
      expect(status.pendingItems).toBe(2); // Item 1 and Item 3 (Item 2 is checked)
    });

    it("should detect items by section", () => {
      fs.writeFileSync(
        roadmapPath,
        `## Phase 1
- [ ] Item 1

## Phase 2
- [ ] Item 2
`
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const status = getRoadmapStatus(tempDir, config);

      expect(status.items).toHaveLength(2);
      expect(status.items[0].section).toBe("Phase 1");
      expect(status.items[1].section).toBe("Phase 2");
    });
  });

  describe("scanRoadmap", () => {
    it("should create PRD files from unprocessed items", () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] New Feature
  This is a description of the new feature.
`
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(1);
      expect(result.created[0]).toBe("01-new-feature.md");
      expect(result.errors).toHaveLength(0);

      // Verify file exists
      const prdFile = path.join(prdDir, "01-new-feature.md");
      expect(fs.existsSync(prdFile)).toBe(true);

      // Verify content has roadmap context
      const content = fs.readFileSync(prdFile, "utf-8");
      expect(content).toContain("<!-- Roadmap Context:");
      expect(content).toContain("Section: Features");
      expect(content).toContain("Description: This is a description of the new feature.");
      expect(content).toContain("# PRD: New Feature");
    });

    it("should skip already-processed items", () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Item 1\n`);

      // Create state with processed item
      const statePath = getStateFilePath(prdDir);
      const state = {
        version: 1,
        lastScan: "",
        items: {
          acadda60: {
            // hash for "item 1"
            title: "Item 1",
            prdFile: "01-item-1.md",
            createdAt: new Date().toISOString(),
          },
        },
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toContain("processed");
    });

    it("should skip checked items", () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [x] Completed Item
`
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toContain("checked");
    });

    it("should update state file after scan", () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] New Feature\n`);

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      scanRoadmap(tempDir, config);

      // Verify state was updated
      const state = loadRoadmapState(prdDir);
      const hashes = Object.keys(state.items);

      expect(hashes).toHaveLength(1);
      expect(state.items[hashes[0]].title).toBe("New Feature");
      expect(state.items[hashes[0]].prdFile).toBe("01-new-feature.md");
      expect(state.lastScan).not.toBe("");
    });

    it("should detect duplicates by existing PRD title match", () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Existing Feature\n`);

      // Create an existing PRD file with matching title
      fs.writeFileSync(path.join(prdDir, "05-existing-feature.md"), "# PRD: Existing Feature\n");

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toContain("duplicate by title");
    });

    it("should use correct numbering for new PRDs", () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] Feature A
- [ ] Feature B
`
      );

      // Create existing PRD with number 05
      fs.writeFileSync(path.join(prdDir, "05-existing.md"), "# PRD: Existing\n");

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(2);
      expect(result.created).toContain("06-feature-a.md");
      expect(result.created).toContain("07-feature-b.md");
    });

    it("should handle empty roadmap", () => {
      fs.writeFileSync(roadmapPath, `## Features\n`);

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle heading-based items", () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features

### Implement Feature X

This is a detailed description.
It has multiple lines.

### Add Feature Y

Another description.
`
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(2);
      expect(result.created).toContain("01-implement-feature-x.md");
      expect(result.created).toContain("02-add-feature-y.md");

      // Verify content of first PRD
      const content = fs.readFileSync(path.join(prdDir, "01-implement-feature-x.md"), "utf-8");
      expect(content).toContain("# PRD: Implement Feature X");
    });

    it("should do nothing when scanner disabled", () => {
      fs.writeFileSync(roadmapPath, `## Features\n- [ ] Feature A\n`);

      const config = {
        ...disabledConfig,
        prdDir: path.relative(tempDir, prdDir),
      };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it("should handle special characters in title", () => {
      fs.writeFileSync(
        roadmapPath,
        `## Features
- [ ] Feature with Special/Characters & Symbols!
`
      );

      const config = { ...defaultConfig, prdDir: path.relative(tempDir, prdDir) };
      const result = scanRoadmap(tempDir, config);

      expect(result.created).toHaveLength(1);
      // slugify should convert special chars to hyphens
      expect(result.created[0]).toMatch(/01-feature-with-special-characters-symbols\.md/);
    });
  });
});
