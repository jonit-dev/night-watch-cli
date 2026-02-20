/**
 * Tests for board label taxonomy and utilities.
 */

import { describe, it, expect } from "vitest";
import {
  PRIORITY_LABELS,
  CATEGORY_LABELS,
  HORIZON_LABELS,
  isValidPriority,
  isValidCategory,
  isValidHorizon,
  extractPriority,
  extractCategory,
  extractHorizon,
  sortByPriority,
  type IBoardIssue,
} from "@/board/labels.js";

describe("board labels", () => {
  describe("PRIORITY_LABELS", () => {
    it("contains P0, P1, P2", () => {
      expect(PRIORITY_LABELS).toEqual(["P0", "P1", "P2"]);
    });
  });

  describe("CATEGORY_LABELS", () => {
    it("contains all roadmap categories", () => {
      expect(CATEGORY_LABELS).toContain("reliability");
      expect(CATEGORY_LABELS).toContain("quality");
      expect(CATEGORY_LABELS).toContain("product");
      expect(CATEGORY_LABELS).toContain("ux");
      expect(CATEGORY_LABELS).toContain("provider");
      expect(CATEGORY_LABELS).toContain("team");
      expect(CATEGORY_LABELS).toContain("platform");
      expect(CATEGORY_LABELS).toContain("intelligence");
      expect(CATEGORY_LABELS).toContain("ecosystem");
    });

    it("has exactly 9 categories", () => {
      expect(CATEGORY_LABELS).toHaveLength(9);
    });
  });

  describe("HORIZON_LABELS", () => {
    it("contains short-term, medium-term, long-term", () => {
      expect(HORIZON_LABELS).toEqual(["short-term", "medium-term", "long-term"]);
    });
  });

  describe("isValidPriority", () => {
    it("returns true for valid priorities", () => {
      expect(isValidPriority("P0")).toBe(true);
      expect(isValidPriority("P1")).toBe(true);
      expect(isValidPriority("P2")).toBe(true);
    });

    it("returns false for invalid priorities", () => {
      expect(isValidPriority("P3")).toBe(false);
      expect(isValidPriority("p0")).toBe(false);
      expect(isValidPriority("critical")).toBe(false);
      expect(isValidPriority("")).toBe(false);
    });
  });

  describe("isValidCategory", () => {
    it("returns true for valid categories", () => {
      expect(isValidCategory("reliability")).toBe(true);
      expect(isValidCategory("quality")).toBe(true);
      expect(isValidCategory("product")).toBe(true);
    });

    it("returns false for invalid categories", () => {
      expect(isValidCategory("Reliability")).toBe(false);
      expect(isValidCategory("unknown")).toBe(false);
      expect(isValidCategory("")).toBe(false);
    });
  });

  describe("isValidHorizon", () => {
    it("returns true for valid horizons", () => {
      expect(isValidHorizon("short-term")).toBe(true);
      expect(isValidHorizon("medium-term")).toBe(true);
      expect(isValidHorizon("long-term")).toBe(true);
    });

    it("returns false for invalid horizons", () => {
      expect(isValidHorizon("Short-Term")).toBe(false);
      expect(isValidHorizon("immediate")).toBe(false);
      expect(isValidHorizon("")).toBe(false);
    });
  });

  describe("extractPriority", () => {
    const makeIssue = (labels: string[]): IBoardIssue => ({
      id: "I_1",
      number: 1,
      title: "Test",
      body: "",
      url: "https://github.com/owner/repo/issues/1",
      column: "Ready",
      labels,
      assignees: [],
    });

    it("extracts P0 from issue labels", () => {
      expect(extractPriority(makeIssue(["P0", "reliability"]))).toBe("P0");
    });

    it("extracts P1 from issue labels", () => {
      expect(extractPriority(makeIssue(["bug", "P1"]))).toBe("P1");
    });

    it("extracts P2 from issue labels", () => {
      expect(extractPriority(makeIssue(["P2"]))).toBe("P2");
    });

    it("returns null when no priority label present", () => {
      expect(extractPriority(makeIssue(["reliability", "short-term"]))).toBeNull();
      expect(extractPriority(makeIssue([]))).toBeNull();
    });
  });

  describe("extractCategory", () => {
    const makeIssue = (labels: string[]): IBoardIssue => ({
      id: "I_1",
      number: 1,
      title: "Test",
      body: "",
      url: "https://github.com/owner/repo/issues/1",
      column: "Ready",
      labels,
      assignees: [],
    });

    it("extracts category from issue labels", () => {
      expect(extractCategory(makeIssue(["P0", "reliability"]))).toBe("reliability");
      expect(extractCategory(makeIssue(["quality"]))).toBe("quality");
    });

    it("returns null when no category label present", () => {
      expect(extractCategory(makeIssue(["P0", "short-term"]))).toBeNull();
      expect(extractCategory(makeIssue([]))).toBeNull();
    });
  });

  describe("extractHorizon", () => {
    const makeIssue = (labels: string[]): IBoardIssue => ({
      id: "I_1",
      number: 1,
      title: "Test",
      body: "",
      url: "https://github.com/owner/repo/issues/1",
      column: "Ready",
      labels,
      assignees: [],
    });

    it("extracts horizon from issue labels", () => {
      expect(extractHorizon(makeIssue(["P0", "short-term"]))).toBe("short-term");
      expect(extractHorizon(makeIssue(["medium-term"]))).toBe("medium-term");
      expect(extractHorizon(makeIssue(["long-term"]))).toBe("long-term");
    });

    it("returns null when no horizon label present", () => {
      expect(extractHorizon(makeIssue(["P0", "reliability"]))).toBeNull();
      expect(extractHorizon(makeIssue([]))).toBeNull();
    });
  });

  describe("sortByPriority", () => {
    const makeIssue = (number: number, labels: string[]): IBoardIssue => ({
      id: `I_${number}`,
      number,
      title: `Issue ${number}`,
      body: "",
      url: `https://github.com/owner/repo/issues/${number}`,
      column: "Ready",
      labels,
      assignees: [],
    });

    it("sorts P0 before P1 before P2 before unlabeled", () => {
      const issues = [
        makeIssue(1, ["P2"]),
        makeIssue(2, []),
        makeIssue(3, ["P0"]),
        makeIssue(4, ["P1"]),
      ];

      const sorted = sortByPriority(issues);

      expect(sorted[0].number).toBe(3); // P0
      expect(sorted[1].number).toBe(4); // P1
      expect(sorted[2].number).toBe(1); // P2
      expect(sorted[3].number).toBe(2); // unlabeled
    });

    it("does not modify original array", () => {
      const issues = [makeIssue(1, ["P2"]), makeIssue(2, ["P0"])];
      const originalOrder = issues.map((i) => i.number);

      sortByPriority(issues);

      expect(issues.map((i) => i.number)).toEqual(originalOrder);
    });
  });
});
