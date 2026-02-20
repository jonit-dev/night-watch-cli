/**
 * Tests for the prd command
 *
 * Tests utility functions directly and integration tests via execSync.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { slugify, getNextPrdNumber } from "@/cli/commands/prd.js";

// Resolve the project root directory for running CLI commands
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const CLI_ROOT = path.resolve(__dirname, "..", "..");
const TSCONFIG_PATH = path.join(CLI_ROOT, "tsconfig.json");
const NODE_BIN = process.execPath;
const CLI_PATH = path.join(CLI_ROOT, "..", "dist", "cli.js");
const NODE_CMD = `"${NODE_BIN}" "${CLI_PATH}"`;

describe("prd command", () => {
  describe("slugify", () => {
    it("should slugify name correctly", () => {
      expect(slugify("Add User Auth")).toBe("add-user-auth");
    });

    it("should handle special characters", () => {
      expect(slugify("Hello World!!! @#$")).toBe("hello-world");
    });

    it("should handle leading and trailing hyphens", () => {
      expect(slugify("--test--")).toBe("test");
    });

    it("should handle multiple consecutive spaces", () => {
      expect(slugify("foo   bar   baz")).toBe("foo-bar-baz");
    });

    it("should handle single word", () => {
      expect(slugify("Authentication")).toBe("authentication");
    });

    it("should handle numbers", () => {
      expect(slugify("Phase 2 Implementation")).toBe("phase-2-implementation");
    });
  });

  describe("getNextPrdNumber", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-prd-num-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should return 1 for empty directory", () => {
      expect(getNextPrdNumber(tempDir)).toBe(1);
    });

    it("should return 1 for non-existent directory", () => {
      expect(getNextPrdNumber(path.join(tempDir, "nonexistent"))).toBe(1);
    });

    it("should auto-number based on existing files", () => {
      fs.writeFileSync(path.join(tempDir, "01-first.md"), "");
      fs.writeFileSync(path.join(tempDir, "02-second.md"), "");
      fs.writeFileSync(path.join(tempDir, "05-fifth.md"), "");

      expect(getNextPrdNumber(tempDir)).toBe(6);
    });

    it("should ignore NIGHT-WATCH-SUMMARY.md", () => {
      fs.writeFileSync(path.join(tempDir, "NIGHT-WATCH-SUMMARY.md"), "");
      expect(getNextPrdNumber(tempDir)).toBe(1);
    });

    it("should ignore non-numbered files", () => {
      fs.writeFileSync(path.join(tempDir, "readme.md"), "");
      fs.writeFileSync(path.join(tempDir, "03-some-prd.md"), "");
      expect(getNextPrdNumber(tempDir)).toBe(4);
    });
  });

  describe("prd create (integration)", () => {
    let tempDir: string;
    let prdDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-prd-test-"));
      prdDir = path.join(tempDir, "docs", "PRDs", "night-watch");
      fs.mkdirSync(prdDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "night-watch.config.json"),
        JSON.stringify({ prdDir: "docs/PRDs/night-watch" })
      );
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function runPrdCreate(args: string): string {
      return execSync(
        `${NODE_CMD} prd create ${args}`,
        {
          encoding: "utf-8",
          cwd: tempDir,
          env: { ...process.env, NODE_ENV: "test" },
        }
      );
    }

    it("should create PRD file in correct directory", () => {
      const output = runPrdCreate('"Add User Auth"');

      expect(output).toContain("Created");
      expect(output).toContain("Add User Auth");

      // File should exist with auto-numbering
      const files = fs.readdirSync(prdDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBe(1);
      expect(files[0]).toBe("01-add-user-auth.md");
    });

    it("should skip numbering with --no-number", () => {
      const output = runPrdCreate('--no-number "Setup Database"');

      expect(output).toContain("Created");

      const files = fs.readdirSync(prdDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBe(1);
      expect(files[0]).toBe("setup-database.md");
    });

    it("should parse --deps flag", () => {
      runPrdCreate('"Auth Feature" --deps "01-setup.md,02-models.md"');

      const files = fs.readdirSync(prdDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBe(1);

      const content = fs.readFileSync(path.join(prdDir, files[0]), "utf-8");
      expect(content).toContain("01-setup.md");
      expect(content).toContain("02-models.md");
      expect(content).toContain("Depends on:");
    });

    it("should use custom template with --template", () => {
      const customTemplatePath = path.join(tempDir, "custom.md");
      fs.writeFileSync(
        customTemplatePath,
        "# Custom: {{TITLE}}\n\nPhases: {{PHASES}}\n"
      );

      runPrdCreate(`"My Feature" --template "${customTemplatePath}"`);

      const files = fs.readdirSync(prdDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBe(1);

      const content = fs.readFileSync(path.join(prdDir, files[0]), "utf-8");
      expect(content).toContain("# Custom: My Feature");
      expect(content).toContain("Phase 1:");
    });

    it("should not overwrite existing file", () => {
      // Create the file that would be generated
      fs.writeFileSync(path.join(prdDir, "01-existing.md"), "existing content");

      try {
        runPrdCreate('"Existing"');
        // Should not reach here
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        const error = err as { stderr?: string; status?: number };
        expect(error.status).not.toBe(0);
      }
    });

    it("should set correct phase count with --phases", () => {
      runPrdCreate('"Multi Phase" --phases 5');

      const files = fs.readdirSync(prdDir).filter((f) => f.endsWith(".md"));
      const content = fs.readFileSync(path.join(prdDir, files[0]), "utf-8");

      expect(content).toContain("Phase 1:");
      expect(content).toContain("Phase 5:");
    });

    it("should auto-number sequentially", () => {
      // Create first PRD
      runPrdCreate('"First PRD"');

      // Create second PRD
      runPrdCreate('"Second PRD"');

      const files = fs
        .readdirSync(prdDir)
        .filter((f) => f.endsWith(".md"))
        .sort();
      expect(files).toContain("01-first-prd.md");
      expect(files).toContain("02-second-prd.md");
    });

    it("should create prd directory if it does not exist", () => {
      // Remove the prd directory
      fs.rmSync(prdDir, { recursive: true, force: true });

      const output = runPrdCreate('"New Feature"');

      expect(output).toContain("Created");
      expect(fs.existsSync(prdDir)).toBe(true);
    });
  });

  describe("prd list (integration)", () => {
    let tempDir: string;
    let prdDir: string;
    let doneDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nw-prd-list-test-"));
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

    function runPrdList(args = ""): string {
      return execSync(
        `${NODE_CMD} prd list ${args}`,
        {
          encoding: "utf-8",
          cwd: tempDir,
          env: { ...process.env, NODE_ENV: "test" },
        }
      );
    }

    it("should show pending PRDs", () => {
      fs.writeFileSync(
        path.join(prdDir, "01-feature.md"),
        "# PRD: Feature\n\n**Depends on:** `setup.md`\n"
      );
      fs.writeFileSync(
        path.join(prdDir, "02-other.md"),
        "# PRD: Other\n"
      );

      const output = runPrdList();

      expect(output).toContain("01-feature.md");
      expect(output).toContain("02-other.md");
      expect(output).toContain("pending");
    });

    it("should show done PRDs", () => {
      fs.writeFileSync(
        path.join(doneDir, "00-setup.md"),
        "# PRD: Setup\n"
      );

      const output = runPrdList();

      expect(output).toContain("00-setup.md");
      expect(output).toContain("done");
    });

    it("should output valid JSON with --json flag", () => {
      fs.writeFileSync(
        path.join(prdDir, "01-feat.md"),
        "# PRD: Feat\n\n**Depends on:** `base.md`\n"
      );
      fs.writeFileSync(
        path.join(doneDir, "00-base.md"),
        "# PRD: Base\n"
      );

      const output = runPrdList("--json");
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty("pending");
      expect(parsed).toHaveProperty("done");
      expect(parsed.pending).toHaveLength(1);
      expect(parsed.done).toHaveLength(1);
      expect(parsed.pending[0].name).toBe("01-feat.md");
      expect(parsed.pending[0].dependencies).toContain("base.md");
      expect(parsed.done[0].name).toBe("00-base.md");
    });

    it("should show no PRDs message when empty", () => {
      // Remove all md files
      const files = fs.readdirSync(prdDir);
      for (const f of files) {
        if (f.endsWith(".md")) fs.unlinkSync(path.join(prdDir, f));
      }

      const output = runPrdList();

      expect(output).toContain("No PRDs found");
    });

    it("should show claimed status when .claim file exists", () => {
      fs.writeFileSync(
        path.join(prdDir, "01-feature.md"),
        "# PRD: Feature\n"
      );
      // Create an active claim file
      const claimData = JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        hostname: "test-host",
        pid: 12345,
      });
      fs.writeFileSync(
        path.join(prdDir, "01-feature.md.claim"),
        claimData
      );

      const output = runPrdList();

      expect(output).toContain("claimed");
      expect(output).toContain("01-feature.md");
    });

    it("should show pending for stale .claim file", () => {
      fs.writeFileSync(
        path.join(prdDir, "01-feature.md"),
        "# PRD: Feature\n"
      );
      // Create a stale claim file (timestamp from year 2001)
      const claimData = JSON.stringify({
        timestamp: 1000000000,
        hostname: "old-host",
        pid: 99999,
      });
      fs.writeFileSync(
        path.join(prdDir, "01-feature.md.claim"),
        claimData
      );

      const output = runPrdList();

      expect(output).toContain("pending");
      expect(output).toContain("01-feature.md");
    });
  });
});
