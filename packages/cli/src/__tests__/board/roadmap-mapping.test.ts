/**
 * Tests for roadmap section to label mapping.
 */

import { describe, it, expect } from "vitest";
import {
  getLabelsForSection,
  calculateStringSimilarity,
  findMatchingIssue,
  ROADMAP_SECTION_MAPPINGS,
} from "@/board/roadmap-mapping.js";

describe("roadmap-mapping", () => {
  describe("ROADMAP_SECTION_MAPPINGS", () => {
    it("contains mappings for all 9 roadmap sections", () => {
      const categories = new Set(ROADMAP_SECTION_MAPPINGS.map((m) => m.category));
      expect(categories).toContain("reliability");
      expect(categories).toContain("quality");
      expect(categories).toContain("product");
      expect(categories).toContain("ux");
      expect(categories).toContain("provider");
      expect(categories).toContain("team");
      expect(categories).toContain("platform");
      expect(categories).toContain("intelligence");
      expect(categories).toContain("ecosystem");
    });
  });

  describe("getLabelsForSection", () => {
    it("maps reliability section correctly", () => {
      const result = getLabelsForSection("1) Reliability and correctness hardening");
      expect(result).toEqual({ category: "reliability", horizon: "short-term" });
    });

    it("maps quality section correctly", () => {
      const result = getLabelsForSection("2) Quality gates and developer workflow");
      expect(result).toEqual({ category: "quality", horizon: "short-term" });
    });

    it("maps product section correctly", () => {
      const result = getLabelsForSection("3) Product completeness for core operators");
      expect(result).toEqual({ category: "product", horizon: "short-term" });
    });

    it("maps ux section correctly (medium-term)", () => {
      const result = getLabelsForSection("4) Unified operations experience");
      expect(result).toEqual({ category: "ux", horizon: "medium-term" });
    });

    it("maps provider section correctly (medium-term)", () => {
      const result = getLabelsForSection("5) Provider and execution platform expansion");
      expect(result).toEqual({ category: "provider", horizon: "medium-term" });
    });

    it("maps team section correctly (medium-term)", () => {
      const result = getLabelsForSection("6) Team and multi-project ergonomics");
      expect(result).toEqual({ category: "team", horizon: "medium-term" });
    });

    it("maps platform section correctly (long-term)", () => {
      const result = getLabelsForSection("7) Platformization and enterprise readiness");
      expect(result).toEqual({ category: "platform", horizon: "long-term" });
    });

    it("maps intelligence section correctly (long-term)", () => {
      const result = getLabelsForSection("8) Intelligence and autonomous planning");
      expect(result).toEqual({ category: "intelligence", horizon: "long-term" });
    });

    it("maps ecosystem section correctly (long-term)", () => {
      const result = getLabelsForSection("9) Ecosystem and adoption");
      expect(result).toEqual({ category: "ecosystem", horizon: "long-term" });
    });

    it("returns null for unknown section", () => {
      const result = getLabelsForSection("Unknown Section");
      expect(result).toBeNull();
    });

    it("handles section with § symbol", () => {
      const result = getLabelsForSection("§1 Reliability and correctness hardening");
      expect(result).toEqual({ category: "reliability", horizon: "short-term" });
    });
  });

  describe("calculateStringSimilarity", () => {
    it("returns 1 for identical strings", () => {
      expect(calculateStringSimilarity("Hello World", "Hello World")).toBe(1);
    });

    it("returns 1 for identical strings with different case", () => {
      expect(calculateStringSimilarity("Hello World", "hello world")).toBe(1);
    });

    it("returns 1 for identical strings with different whitespace", () => {
      expect(calculateStringSimilarity("  Hello World  ", "Hello World")).toBe(1);
    });

    it("returns 0 for completely different strings", () => {
      expect(calculateStringSimilarity("abc", "xyz")).toBe(0);
    });

    it("returns high similarity for minor differences", () => {
      const similarity = calculateStringSimilarity(
        "Add structured JSON logging",
        "Add structured JSON logging."
      );
      expect(similarity).toBeGreaterThan(0.9);
    });

    it("returns moderate similarity for partial matches", () => {
      const similarity = calculateStringSimilarity(
        "Add structured JSON logging",
        "Add structured logging"
      );
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe("findMatchingIssue", () => {
    const issues = [
      { title: "Add structured JSON logging", id: 1 },
      { title: "Fix bug in parser", id: 2 },
      { title: "Implement feature X", id: 3 },
    ];

    it("finds exact match", () => {
      const match = findMatchingIssue("Add structured JSON logging", issues);
      expect(match).toBeDefined();
      expect(match?.id).toBe(1);
    });

    it("finds case-insensitive match", () => {
      const match = findMatchingIssue("add structured json logging", issues);
      expect(match).toBeDefined();
      expect(match?.id).toBe(1);
    });

    it("finds fuzzy match above threshold", () => {
      const match = findMatchingIssue("Add structured JSON logging.", issues, 0.8);
      expect(match).toBeDefined();
      expect(match?.id).toBe(1);
    });

    it("returns null when no match above threshold", () => {
      const match = findMatchingIssue("Completely different title", issues, 0.8);
      expect(match).toBeNull();
    });

    it("returns best match when multiple candidates", () => {
      const manyIssues = [
        { title: "Add JSON logging", id: 1 },
        { title: "Add XML logging", id: 2 },
      ];
      const match = findMatchingIssue("Add JSON logging", manyIssues, 0.6);
      expect(match).toBeDefined();
      expect(match?.id).toBe(1);
    });

    it("returns null for empty issues array", () => {
      const match = findMatchingIssue("Any title", [], 0.8);
      expect(match).toBeNull();
    });
  });
});
