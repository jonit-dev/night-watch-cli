/**
 * Tests for the retry command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

// Resolve the project root directory for running CLI commands
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const CLI_PATH = path.join(PROJECT_ROOT, "src", "cli.ts");

describe("retry command", () => {
  let tempDir: string;
  let prdDir: string;
  let doneDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-retry-test-"));
    prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
    doneDir = path.join(prdDir, "done");
    fs.mkdirSync(doneDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "night-watch.config.json"),
      JSON.stringify({ prdDir: "docs/PRDs/night-watch" })
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runRetry(prdName: string): { output: string; exitCode: number } {
    try {
      const output = execSync(
        `"${TSX_BIN}" "${CLI_PATH}" retry "${prdName}"`,
        {
          encoding: "utf-8",
          cwd: tempDir,
          stdio: "pipe",
          env: { ...process.env, NODE_ENV: "test" },
          timeout: 30000,
        }
      );
      return { output, exitCode: 0 };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; status?: number };
      return {
        output: error.stdout ?? error.stderr ?? "",
        exitCode: error.status ?? 1,
      };
    }
  }

  describe("should move PRD from done to pending", () => {
    it("moves the file from done/ to prdDir", () => {
      // Setup: Create a PRD in done directory
      const prdContent = "# Test PRD\n\nSome content";
      fs.writeFileSync(path.join(doneDir, "01-test-prd.md"), prdContent);

      const result = runRetry("01-test-prd.md");

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Moved");
      expect(result.output).toContain("01-test-prd.md");
      expect(result.output).toContain("pending");

      // Verify file moved correctly
      expect(fs.existsSync(path.join(prdDir, "01-test-prd.md"))).toBe(true);
      expect(fs.existsSync(path.join(doneDir, "01-test-prd.md"))).toBe(false);

      // Verify content preserved
      expect(fs.readFileSync(path.join(prdDir, "01-test-prd.md"), "utf-8")).toBe(
        prdContent
      );
    });
  });

  describe("should report error for non-existent PRD", () => {
    it("outputs error message and lists available PRDs", () => {
      // Setup: Create some PRDs in done directory
      fs.writeFileSync(path.join(doneDir, "01-existing.md"), "# Existing 1");
      fs.writeFileSync(path.join(doneDir, "02-another.md"), "# Existing 2");

      const result = runRetry("non-existent-prd.md");

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not found");
      expect(result.output).toContain("Available PRDs in done/");
      expect(result.output).toContain("01-existing.md");
      expect(result.output).toContain("02-another.md");
    });

    it("reports no PRDs when done directory is empty", () => {
      const result = runRetry("any-prd.md");

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not found");
      expect(result.output).toContain("No PRDs found in done/");
    });
  });

  describe("should report already pending", () => {
    it("outputs already pending message when PRD is in prdDir", () => {
      // Setup: Create a PRD in pending directory
      fs.writeFileSync(path.join(prdDir, "01-pending-prd.md"), "# Pending PRD");

      const result = runRetry("01-pending-prd.md");

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already pending");
      expect(result.output).toContain("nothing to retry");

      // Verify file still exists in pending
      expect(fs.existsSync(path.join(prdDir, "01-pending-prd.md"))).toBe(true);
    });
  });

  describe("should handle .md extension in name", () => {
    it("works when .md extension is provided", () => {
      fs.writeFileSync(path.join(doneDir, "02-test.md"), "# Test");

      const result = runRetry("02-test.md");

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(path.join(prdDir, "02-test.md"))).toBe(true);
    });

    it("works when .md extension is NOT provided", () => {
      fs.writeFileSync(path.join(doneDir, "03-sample.md"), "# Sample");

      const result = runRetry("03-sample");

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(path.join(prdDir, "03-sample.md"))).toBe(true);
    });

    it("handles already pending without .md extension", () => {
      fs.writeFileSync(path.join(prdDir, "04-pending.md"), "# Pending");

      const result = runRetry("04-pending");

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("already pending");
    });
  });
});
