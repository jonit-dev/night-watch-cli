/**
 * Tests for Roadmap Parser and State Manager
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  parseRoadmap,
  generateItemHash,
  getUncheckedItems,
  groupBySection,
  type IRoadmapItem,
} from "../utils/roadmap-parser.js";
import {
  loadRoadmapState,
  saveRoadmapState,
  isItemProcessed,
  createEmptyState,
  markItemProcessed,
  unmarkItemProcessed,
  getProcessedHashes,
  getStateItem,
  getStateFilePath,
  type IRoadmapState,
} from "../utils/roadmap-state.js";

describe("roadmap-parser", () => {
  describe("generateItemHash", () => {
    it("should generate consistent hashes for same title", () => {
      const hash1 = generateItemHash("Implement Feature X");
      const hash2 = generateItemHash("Implement Feature X");
      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different titles", () => {
      const hash1 = generateItemHash("Implement Feature X");
      const hash2 = generateItemHash("Implement Feature Y");
      expect(hash1).not.toBe(hash2);
    });

    it("should generate same hash regardless of case", () => {
      const hash1 = generateItemHash("Implement Feature X");
      const hash2 = generateItemHash("implement feature x");
      const hash3 = generateItemHash("IMPLEMENT FEATURE X");
      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
    });

    it("should generate same hash regardless of leading/trailing whitespace", () => {
      const hash1 = generateItemHash("Implement Feature X");
      const hash2 = generateItemHash("  Implement Feature X  ");
      expect(hash1).toBe(hash2);
    });

    it("should return 8 character hash", () => {
      const hash = generateItemHash("Any Title");
      expect(hash).toHaveLength(8);
    });

    it("should return hexadecimal string", () => {
      const hash = generateItemHash("Any Title");
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  describe("parseRoadmap", () => {
    it("should parse checklist items from ROADMAP.md", () => {
      const content = `## Features

- [ ] Implement Feature X
- [ ] Add Feature Y
`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(2);
      expect(items[0].title).toBe("Implement Feature X");
      expect(items[0].checked).toBe(false);
      expect(items[0].section).toBe("Features");
      expect(items[1].title).toBe("Add Feature Y");
      expect(items[1].checked).toBe(false);
    });

    it("should mark checked items as checked", () => {
      const content = `## Tasks

- [x] Completed Task
- [ ] Pending Task
- [X] Another Completed (uppercase X)
`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(3);
      expect(items[0].checked).toBe(true);
      expect(items[1].checked).toBe(false);
      expect(items[2].checked).toBe(true);
    });

    it("should parse heading-based items", () => {
      const content = `## Features

### Implement Feature X

This is a detailed description of Feature X.
It can span multiple lines.

### Add Feature Y

Description of Feature Y.
`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(2);
      expect(items[0].title).toBe("Implement Feature X");
      expect(items[0].description).toContain("detailed description of Feature X");
      expect(items[0].checked).toBe(false);
      expect(items[1].title).toBe("Add Feature Y");
    });

    it("should extract section names from parent headings", () => {
      const content = `## Phase 1: Core

- [ ] Item 1

## Phase 2: Advanced

- [ ] Item 2

### Heading Item

Description here.
`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(3);
      expect(items[0].section).toBe("Phase 1: Core");
      expect(items[1].section).toBe("Phase 2: Advanced");
      expect(items[2].section).toBe("Phase 2: Advanced");
    });

    it("should handle empty ROADMAP.md", () => {
      const content = "";
      const items = parseRoadmap(content);
      expect(items).toHaveLength(0);
    });

    it("should handle ROADMAP.md with only headings", () => {
      const content = `## Section 1

## Section 2

### Subsection
`;
      const items = parseRoadmap(content);
      // ### creates an item, but ## does not
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Subsection");
    });

    it("should handle mixed formats", () => {
      const content = `## Section A

- [ ] Checklist Item 1
  With description

### Heading Item

Description for heading item.

- [x] Completed Checklist Item

## Section B

- [ ] Another Item
`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(4);

      // Checklist Item 1
      expect(items[0].title).toBe("Checklist Item 1");
      expect(items[0].description).toBe("With description");
      expect(items[0].checked).toBe(false);
      expect(items[0].section).toBe("Section A");

      // Heading Item
      expect(items[1].title).toBe("Heading Item");
      expect(items[1].description).toContain("Description for heading item");
      expect(items[1].checked).toBe(false);

      // Completed Checklist Item
      expect(items[2].title).toBe("Completed Checklist Item");
      expect(items[2].checked).toBe(true);

      // Another Item
      expect(items[3].section).toBe("Section B");
    });

    it("should extract description from indented lines after checklist item", () => {
      const content = `## Tasks

- [ ] Complex Task
  This is the first line of description.
  This is the second line.
  Third line here.
`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(1);
      expect(items[0].description).toBe(
        "This is the first line of description.\nThis is the second line.\nThird line here."
      );
    });

    it("should stop description at non-indented line", () => {
      const content = `## Tasks

- [ ] Task One
  Description line.
- [ ] Task Two
`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(2);
      expect(items[0].description).toBe("Description line.");
      expect(items[1].title).toBe("Task Two");
    });

    it("should use General section when no ## heading exists", () => {
      const content = `- [ ] Item without section`;

      const items = parseRoadmap(content);

      expect(items).toHaveLength(1);
      expect(items[0].section).toBe("General");
    });
  });

  describe("getUncheckedItems", () => {
    it("should filter to only unchecked items", () => {
      const items: IRoadmapItem[] = [
        { hash: "a1", title: "Done", description: "", checked: true, section: "S1" },
        { hash: "b2", title: "Pending", description: "", checked: false, section: "S1" },
        { hash: "c3", title: "Done 2", description: "", checked: true, section: "S1" },
        { hash: "d4", title: "Pending 2", description: "", checked: false, section: "S1" },
      ];

      const unchecked = getUncheckedItems(items);

      expect(unchecked).toHaveLength(2);
      expect(unchecked[0].title).toBe("Pending");
      expect(unchecked[1].title).toBe("Pending 2");
    });

    it("should return empty array if all checked", () => {
      const items: IRoadmapItem[] = [
        { hash: "a1", title: "Done", description: "", checked: true, section: "S1" },
        { hash: "b2", title: "Done 2", description: "", checked: true, section: "S1" },
      ];

      const unchecked = getUncheckedItems(items);
      expect(unchecked).toHaveLength(0);
    });
  });

  describe("groupBySection", () => {
    it("should group items by section", () => {
      const items: IRoadmapItem[] = [
        { hash: "a1", title: "A1", description: "", checked: false, section: "Section A" },
        { hash: "a2", title: "A2", description: "", checked: false, section: "Section A" },
        { hash: "b1", title: "B1", description: "", checked: false, section: "Section B" },
        { hash: "c1", title: "C1", description: "", checked: false, section: "Section C" },
        { hash: "b2", title: "B2", description: "", checked: false, section: "Section B" },
      ];

      const groups = groupBySection(items);

      expect(Object.keys(groups)).toHaveLength(3);
      expect(groups["Section A"]).toHaveLength(2);
      expect(groups["Section B"]).toHaveLength(2);
      expect(groups["Section C"]).toHaveLength(1);
    });

    it("should return empty object for empty items", () => {
      const groups = groupBySection([]);
      expect(Object.keys(groups)).toHaveLength(0);
    });
  });
});

describe("roadmap-state", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-state-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("createEmptyState", () => {
    it("should create state with correct defaults", () => {
      const state = createEmptyState();

      expect(state.version).toBe(1);
      expect(state.lastScan).toBe("");
      expect(state.items).toEqual({});
    });
  });

  describe("getStateFilePath", () => {
    it("should return correct path", () => {
      const filePath = getStateFilePath("/path/to/prds");
      expect(filePath).toBe("/path/to/prds/.roadmap-state.json");
    });
  });

  describe("loadRoadmapState", () => {
    it("should load empty state when file missing", () => {
      const state = loadRoadmapState(tempDir);

      expect(state.version).toBe(1);
      expect(state.lastScan).toBe("");
      expect(state.items).toEqual({});
    });

    it("should load existing state file", () => {
      const statePath = getStateFilePath(tempDir);
      const existingState: IRoadmapState = {
        version: 1,
        lastScan: "2024-01-15T10:00:00.000Z",
        items: {
          abc12345: {
            title: "Test Item",
            prdFile: "01-test-item.md",
            createdAt: "2024-01-15T09:00:00.000Z",
          },
        },
      };

      fs.writeFileSync(statePath, JSON.stringify(existingState, null, 2));

      const loaded = loadRoadmapState(tempDir);

      expect(loaded.version).toBe(1);
      expect(loaded.lastScan).toBe("2024-01-15T10:00:00.000Z");
      expect(loaded.items["abc12345"].title).toBe("Test Item");
      expect(loaded.items["abc12345"].prdFile).toBe("01-test-item.md");
    });

    it("should return empty state for invalid JSON", () => {
      const statePath = getStateFilePath(tempDir);
      fs.writeFileSync(statePath, "{ invalid json }");

      const state = loadRoadmapState(tempDir);

      expect(state.version).toBe(1);
      expect(state.items).toEqual({});
    });

    it("should return empty state for invalid structure", () => {
      const statePath = getStateFilePath(tempDir);
      fs.writeFileSync(statePath, JSON.stringify({ foo: "bar" }));

      const state = loadRoadmapState(tempDir);

      expect(state.version).toBe(1);
      expect(state.items).toEqual({});
    });
  });

  describe("saveRoadmapState", () => {
    it("should save and reload state correctly", () => {
      const state = createEmptyState();
      state.items["abc12345"] = {
        title: "Test Item",
        prdFile: "01-test-item.md",
        createdAt: "2024-01-15T09:00:00.000Z",
      };

      saveRoadmapState(tempDir, state);

      // Verify file was created
      const statePath = getStateFilePath(tempDir);
      expect(fs.existsSync(statePath)).toBe(true);

      // Reload and verify
      const loaded = loadRoadmapState(tempDir);
      expect(loaded.items["abc12345"].title).toBe("Test Item");
      expect(loaded.lastScan).not.toBe("");
    });

    it("should update lastScan timestamp on save", () => {
      const state = createEmptyState();
      state.lastScan = "2024-01-01T00:00:00.000Z";

      saveRoadmapState(tempDir, state);

      const loaded = loadRoadmapState(tempDir);
      expect(loaded.lastScan).not.toBe("2024-01-01T00:00:00.000Z");
    });

    it("should create directory if it does not exist", () => {
      const nestedDir = path.join(tempDir, "nested", "dir");
      const state = createEmptyState();

      saveRoadmapState(nestedDir, state);

      const statePath = getStateFilePath(nestedDir);
      expect(fs.existsSync(statePath)).toBe(true);
    });
  });

  describe("isItemProcessed", () => {
    it("should detect processed items", () => {
      const state = createEmptyState();
      state.items["abc12345"] = {
        title: "Test",
        prdFile: "test.md",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      expect(isItemProcessed(state, "abc12345")).toBe(true);
      expect(isItemProcessed(state, "xyz99999")).toBe(false);
    });

    it("should return false for empty state", () => {
      const state = createEmptyState();
      expect(isItemProcessed(state, "anyhash")).toBe(false);
    });
  });

  describe("markItemProcessed", () => {
    it("should add item to state", () => {
      const state = createEmptyState();

      markItemProcessed(state, "abc12345", {
        title: "New Item",
        prdFile: "02-new-item.md",
        createdAt: "2024-01-15T10:00:00.000Z",
      });

      expect(state.items["abc12345"].title).toBe("New Item");
      expect(state.items["abc12345"].prdFile).toBe("02-new-item.md");
    });

    it("should overwrite existing item with same hash", () => {
      const state = createEmptyState();
      state.items["abc12345"] = {
        title: "Old Title",
        prdFile: "old.md",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      markItemProcessed(state, "abc12345", {
        title: "New Title",
        prdFile: "new.md",
        createdAt: "2024-01-15T00:00:00.000Z",
      });

      expect(state.items["abc12345"].title).toBe("New Title");
      expect(state.items["abc12345"].prdFile).toBe("new.md");
    });
  });

  describe("unmarkItemProcessed", () => {
    it("should remove item from state", () => {
      const state = createEmptyState();
      state.items["abc12345"] = {
        title: "Test",
        prdFile: "test.md",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const result = unmarkItemProcessed(state, "abc12345");

      expect(result).toBe(true);
      expect("abc12345" in state.items).toBe(false);
    });

    it("should return false if item not found", () => {
      const state = createEmptyState();
      const result = unmarkItemProcessed(state, "nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("getProcessedHashes", () => {
    it("should return all hashes", () => {
      const state = createEmptyState();
      state.items["aaa11111"] = { title: "A", prdFile: "a.md", createdAt: "" };
      state.items["bbb22222"] = { title: "B", prdFile: "b.md", createdAt: "" };
      state.items["ccc33333"] = { title: "C", prdFile: "c.md", createdAt: "" };

      const hashes = getProcessedHashes(state);

      expect(hashes).toHaveLength(3);
      expect(hashes).toContain("aaa11111");
      expect(hashes).toContain("bbb22222");
      expect(hashes).toContain("ccc33333");
    });

    it("should return empty array for empty state", () => {
      const state = createEmptyState();
      expect(getProcessedHashes(state)).toHaveLength(0);
    });
  });

  describe("getStateItem", () => {
    it("should return item if exists", () => {
      const state = createEmptyState();
      state.items["abc12345"] = {
        title: "Test Item",
        prdFile: "test.md",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const item = getStateItem(state, "abc12345");

      expect(item).toBeDefined();
      expect(item?.title).toBe("Test Item");
    });

    it("should return undefined if not exists", () => {
      const state = createEmptyState();
      const item = getStateItem(state, "nonexistent");
      expect(item).toBeUndefined();
    });
  });
});
