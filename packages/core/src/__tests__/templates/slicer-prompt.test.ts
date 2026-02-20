/**
 * Tests for the Slicer Prompt Template rendering system
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  renderSlicerPrompt,
  loadSlicerTemplate,
  clearTemplateCache,
  createSlicerPromptVars,
  ISlicerPromptVars,
} from "../../templates/slicer-prompt.js";

function createTestVars(overrides: Partial<ISlicerPromptVars> = {}): ISlicerPromptVars {
  return {
    title: "Test Feature",
    section: "Features",
    description: "A test feature description",
    outputFilePath: "/path/to/prds/01-test-feature.md",
    prdDir: "/path/to/prds",
    ...overrides,
  };
}

describe("slicer-prompt", () => {
  beforeEach(() => {
    // Clear the template cache before each test
    clearTemplateCache();
  });

  describe("renderSlicerPrompt", () => {
    it("should interpolate all placeholders", () => {
      const vars = createTestVars({
        title: "My Awesome Feature",
        section: "Roadmap",
        description: "This feature does amazing things",
        outputFilePath: "/project/docs/PRDs/42-awesome.md",
        prdDir: "/project/docs/PRDs",
      });

      const result = renderSlicerPrompt(vars);

      expect(result).toContain("My Awesome Feature");
      expect(result).toContain("Roadmap");
      expect(result).toContain("This feature does amazing things");
      expect(result).toContain("/project/docs/PRDs/42-awesome.md");
      expect(result).toContain("/project/docs/PRDs");
    });

    it("should not contain any uninterpolated placeholders", () => {
      const vars = createTestVars();

      const result = renderSlicerPrompt(vars);

      expect(result).not.toContain("{{");
      expect(result).not.toContain("}}");
    });

    it("should include prd-creator template structure", () => {
      const vars = createTestVars();

      const result = renderSlicerPrompt(vars);

      // Check for key PRD structure elements
      expect(result).toContain("Complexity");
      expect(result).toContain("Execution Phases");
      expect(result).toContain("Context");
      expect(result).toContain("Solution");
      expect(result).toContain("Acceptance Criteria");
    });

    it("should include complexity scoring guide", () => {
      const vars = createTestVars();

      const result = renderSlicerPrompt(vars);

      expect(result).toContain("COMPLEXITY SCORE");
      expect(result).toContain("Touches 1-5 files");
      expect(result).toContain("LOW");
      expect(result).toContain("MEDIUM");
      expect(result).toContain("HIGH");
    });

    it("should include instructions to write the file", () => {
      const vars = createTestVars({
        outputFilePath: "/custom/path/feature.md",
      });

      const result = renderSlicerPrompt(vars);

      expect(result).toContain("/custom/path/feature.md");
      expect(result).toContain("Write tool");
    });

    it("should use custom template when provided", () => {
      const vars = createTestVars({ title: "Custom Title" });
      const customTemplate = "Custom Prompt: {{TITLE}} in {{SECTION}}";

      const result = renderSlicerPrompt(vars, customTemplate);

      expect(result).toBe("Custom Prompt: Custom Title in Features");
    });

    it("should handle empty description", () => {
      const vars = createTestVars({ description: "" });

      const result = renderSlicerPrompt(vars);

      // Should still render without errors
      expect(result).toContain("Test Feature");
      expect(result).not.toContain("{{DESCRIPTION}}");
    });

    it("should handle special characters in values", () => {
      const vars = createTestVars({
        title: "Feature with `backticks` and $pecial chars",
        description: "Description with\nnewlines\nand **markdown**",
      });

      const result = renderSlicerPrompt(vars);

      expect(result).toContain("Feature with `backticks` and $pecial chars");
      expect(result).toContain("Description with\nnewlines\nand **markdown**");
    });
  });

  describe("loadSlicerTemplate", () => {
    it("should load template from file", () => {
      const template = loadSlicerTemplate();

      expect(template).toContain("PRD Creator Agent");
      expect(template).toContain("{{TITLE}}");
      expect(template).toContain("{{SECTION}}");
      expect(template).toContain("{{DESCRIPTION}}");
      expect(template).toContain("{{OUTPUT_FILE_PATH}}");
      expect(template).toContain("{{PRD_DIR}}");
    });

    it("should cache the template", () => {
      const template1 = loadSlicerTemplate();
      const template2 = loadSlicerTemplate();

      // Should return the same reference (cached)
      expect(template1).toBe(template2);
    });

    it("should clear cache when requested", () => {
      loadSlicerTemplate();
      clearTemplateCache();

      // After clearing, next load should be fresh
      // (We can't directly test this, but at least verify it doesn't throw)
      const template = loadSlicerTemplate();
      expect(template).toBeTruthy();
    });
  });

  describe("createSlicerPromptVars", () => {
    it("should create variables with correct paths", () => {
      const vars = createSlicerPromptVars(
        "Feature Title",
        "Section Name",
        "Feature description",
        "/path/to/prds",
        "99-feature-title.md",
      );

      expect(vars.title).toBe("Feature Title");
      expect(vars.section).toBe("Section Name");
      expect(vars.description).toBe("Feature description");
      expect(vars.prdDir).toBe("/path/to/prds");
      expect(vars.outputFilePath).toBe("/path/to/prds/99-feature-title.md");
    });

    it("should handle empty description with default", () => {
      const vars = createSlicerPromptVars(
        "Feature",
        "Section",
        "",
        "/prds",
        "file.md",
      );

      expect(vars.description).toBe("(No description provided)");
    });
  });

  describe("integration with prd-creator format", () => {
    it("should produce a prompt that instructs AI to explore the codebase", () => {
      const vars = createTestVars();
      const result = renderSlicerPrompt(vars);

      expect(result).toMatch(/explore/i);
      expect(result).toMatch(/codebase/i);
    });

    it("should produce a prompt that instructs AI to assess complexity", () => {
      const vars = createTestVars();
      const result = renderSlicerPrompt(vars);

      expect(result).toMatch(/assess.*complexity/i);
    });

    it("should produce a prompt that instructs AI to write a complete PRD with all required sections", () => {
      const vars = createTestVars();
      const result = renderSlicerPrompt(vars);

      expect(result).toMatch(/context/i);
      expect(result).toMatch(/solution/i);
      expect(result).toMatch(/phases/i);
      expect(result).toMatch(/tests/i);
      expect(result).toMatch(/acceptance.?criteria/i);
    });

    it("should emphasize the exact output file path", () => {
      const vars = createTestVars({
        outputFilePath: "/exact/path/to/prd.md",
      });
      const result = renderSlicerPrompt(vars);

      // The output file path should appear multiple times for emphasis
      const matches = result.match(/\/exact\/path\/to\/prd\.md/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });
});
