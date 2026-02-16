/**
 * Tests for the PRD template rendering system
 */

import { describe, it, expect } from "vitest";
import {
  PRD_TEMPLATE,
  PrdTemplateVars,
  renderPrdTemplate,
} from "../../templates/prd-template.js";

function createTestVars(overrides: Partial<PrdTemplateVars> = {}): PrdTemplateVars {
  return {
    title: "Test Feature",
    dependsOn: ["phase-1.md", "phase-2.md"],
    complexityScore: 7,
    complexityLevel: "MEDIUM",
    complexityBreakdown: ["3 files to modify", "1 new dependency", "API changes needed"],
    phaseCount: 2,
    ...overrides,
  };
}

describe("prd-template", () => {
  describe("renderPrdTemplate", () => {
    it("should replace title placeholder", () => {
      const vars = createTestVars({ title: "My Awesome Feature" });

      const output = renderPrdTemplate(vars);

      expect(output).toContain("# PRD: My Awesome Feature");
    });

    it("should render dependency line", () => {
      const vars = createTestVars({
        dependsOn: ["setup.md", "auth.md"],
      });

      const output = renderPrdTemplate(vars);

      expect(output).toContain("**Depends on:** `setup.md`, `auth.md`");
    });

    it("should render N phase stubs", () => {
      const vars = createTestVars({ phaseCount: 3 });

      const output = renderPrdTemplate(vars);

      expect(output).toContain("### Phase 1:");
      expect(output).toContain("### Phase 2:");
      expect(output).toContain("### Phase 3:");
      expect(output).not.toContain("### Phase 4:");
    });

    it("should skip depends on when no deps", () => {
      const vars = createTestVars({ dependsOn: [] });

      const output = renderPrdTemplate(vars);

      expect(output).not.toContain("Depends on:");
    });

    it("should use custom template when provided", () => {
      const vars = createTestVars({ title: "Custom Title" });
      const customTemplate = "# Custom: {{TITLE}}\n\nPhases:\n{{PHASES}}";

      const output = renderPrdTemplate(vars, customTemplate);

      expect(output).toContain("# Custom: Custom Title");
      expect(output).toContain("### Phase 1:");
      expect(output).toContain("### Phase 2:");
      expect(output).not.toContain("# PRD:");
    });

    it("should render complexity score and level", () => {
      const vars = createTestVars({
        complexityScore: 9,
        complexityLevel: "HIGH",
      });

      const output = renderPrdTemplate(vars);

      expect(output).toContain("**Complexity: 9");
      expect(output).toContain("HIGH mode**");
    });

    it("should render complexity breakdown as bullet list", () => {
      const vars = createTestVars({
        complexityBreakdown: ["many files", "new API endpoints"],
      });

      const output = renderPrdTemplate(vars);

      expect(output).toContain("- many files");
      expect(output).toContain("- new API endpoints");
    });

    it("should handle empty complexity breakdown", () => {
      const vars = createTestVars({ complexityBreakdown: [] });

      const output = renderPrdTemplate(vars);

      // Should still render without errors
      expect(output).toContain("# PRD: Test Feature");
    });

    it("should render single phase stub with correct structure", () => {
      const vars = createTestVars({ phaseCount: 1 });

      const output = renderPrdTemplate(vars);

      expect(output).toContain("### Phase 1: [Name]");
      expect(output).toContain("**Files (max 5):**");
      expect(output).toContain("**Implementation:**");
      expect(output).toContain("**Tests Required:**");
      expect(output).toContain("**Verification Plan:**");
      expect(output).toContain("**Checkpoint:**");
    });

    it("should include acceptance criteria section", () => {
      const vars = createTestVars();

      const output = renderPrdTemplate(vars);

      expect(output).toContain("## 5. Acceptance Criteria");
      expect(output).toContain("All phases complete");
      expect(output).toContain("Feature is reachable");
    });

    it("should include complexity scoring guide", () => {
      const vars = createTestVars();

      const output = renderPrdTemplate(vars);

      expect(output).toContain("COMPLEXITY SCORE (sum all that apply)");
      expect(output).toContain("Touches 1-5 files");
    });

    it("should include sequence flow section", () => {
      const vars = createTestVars();

      const output = renderPrdTemplate(vars);

      expect(output).toContain("## 3. Sequence Flow");
    });

    it("should include execution phase critical rules", () => {
      const vars = createTestVars();

      const output = renderPrdTemplate(vars);

      expect(output).toContain("Each phase = ONE user-testable vertical slice");
      expect(output).toContain("Max 5 files per phase");
    });

    it("should render single dependency without trailing comma", () => {
      const vars = createTestVars({ dependsOn: ["only-one.md"] });

      const output = renderPrdTemplate(vars);

      const dependsLine = output.split("\n").find((line) => line.includes("Depends on:"));
      expect(dependsLine).toBe("**Depends on:** `only-one.md`");
    });
  });
});
