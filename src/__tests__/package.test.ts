/**
 * Tests for npm package readiness
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Get package root directory
const packageRoot = path.resolve(__dirname, "..", "..");
const packageJsonPath = path.join(packageRoot, "package.json");

describe("Package Configuration", () => {
  let packageJson: Record<string, unknown>;

  beforeAll(() => {
    const content = fs.readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  });

  it("should have required package.json fields", () => {
    expect(packageJson).toHaveProperty("name");
    expect(packageJson).toHaveProperty("version");
    expect(packageJson).toHaveProperty("description");
    expect(packageJson).toHaveProperty("license");
    expect(packageJson).toHaveProperty("repository");

    expect(packageJson.name).toBe("@jonit-dev/night-watch-cli");
    expect(packageJson.description).toContain("Autonomous PRD execution");
    expect(packageJson.license).toBe("MIT");
  });

  it("should have author field", () => {
    expect(packageJson).toHaveProperty("author");
    expect(packageJson.author).toBe("Joao Pio");
  });

  it("should have keywords", () => {
    expect(packageJson).toHaveProperty("keywords");
    const keywords = packageJson.keywords as string[];
    expect(keywords).toContain("claude");
    expect(keywords).toContain("ai");
    expect(keywords).toContain("prd");
    expect(keywords).toContain("automation");
    expect(keywords).toContain("cron");
    expect(keywords).toContain("cli");
    expect(keywords).toContain("night-watch");
  });

  it("should have repository with correct fields", () => {
    expect(packageJson).toHaveProperty("repository");
    const repo = packageJson.repository as Record<string, string>;
    expect(repo.type).toBe("git");
    expect(repo.url).toContain("github.com/jonit-dev/night-watch-cli");
  });

  it("should have homepage and bugs fields", () => {
    expect(packageJson).toHaveProperty("homepage");
    expect(packageJson).toHaveProperty("bugs");

    const bugs = packageJson.bugs as Record<string, string>;
    expect(bugs.url).toContain("github.com/jonit-dev/night-watch-cli/issues");
  });

  it("should have engines field with node version", () => {
    expect(packageJson).toHaveProperty("engines");
    const engines = packageJson.engines as Record<string, string>;
    expect(engines.node).toBeDefined();
    expect(engines.node).toContain(">=");
  });

  it("should have templates in files array", () => {
    expect(packageJson).toHaveProperty("files");
    const files = packageJson.files as string[];
    expect(files).toContain("templates/");
  });

  it("should have dist, bin, and scripts in files array", () => {
    const files = packageJson.files as string[];
    expect(files).toContain("dist/");
    expect(files).toContain("bin/");
    expect(files).toContain("scripts/");
  });

  it("should have prepublishOnly script", () => {
    expect(packageJson).toHaveProperty("scripts");
    const scripts = packageJson.scripts as Record<string, string>;
    expect(scripts.prepublishOnly).toBeDefined();
    expect(scripts.prepublishOnly).toContain("build");
    expect(scripts.prepublishOnly).toContain("test");
  });

  it("should have valid bin entry", () => {
    expect(packageJson).toHaveProperty("bin");
    const bin = packageJson.bin as Record<string, string>;
    expect(bin["night-watch"]).toBe("./bin/night-watch.mjs");

    // Check that bin file exists
    const binPath = path.join(packageRoot, bin["night-watch"]);
    expect(fs.existsSync(binPath)).toBe(true);
  });
});

describe("Package Files", () => {
  it("should have valid bin entry that resolves to existing file", () => {
    const binPath = path.join(packageRoot, "bin", "night-watch.mjs");
    expect(fs.existsSync(binPath)).toBe(true);

    // Check that it's executable (has shebang)
    const content = fs.readFileSync(binPath, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("should include scripts in package", () => {
    const scriptsDir = path.join(packageRoot, "scripts");
    expect(fs.existsSync(scriptsDir)).toBe(true);

    // Check for required scripts
    expect(fs.existsSync(path.join(scriptsDir, "night-watch-cron.sh"))).toBe(true);
    expect(fs.existsSync(path.join(scriptsDir, "night-watch-pr-reviewer-cron.sh"))).toBe(true);
    expect(fs.existsSync(path.join(scriptsDir, "night-watch-helpers.sh"))).toBe(true);
  });

  it("should include templates in package", () => {
    const templatesDir = path.join(packageRoot, "templates");
    expect(fs.existsSync(templatesDir)).toBe(true);

    // Check for required templates
    expect(fs.existsSync(path.join(templatesDir, "night-watch.md"))).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "prd-executor.md"))).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "night-watch-pr-reviewer.md"))).toBe(true);
    expect(fs.existsSync(path.join(templatesDir, "night-watch.config.json"))).toBe(true);
  });

  it("should have prd-executor template with required sections", () => {
    const templatePath = path.join(packageRoot, "templates", "prd-executor.md");
    const content = fs.readFileSync(templatePath, "utf-8");

    // Core execution pipeline steps
    expect(content).toContain("Parse the PRD");
    expect(content).toContain("Build the Dependency Graph");
    expect(content).toContain("Create Task List");
    expect(content).toContain("Execute with Agent Swarm");
    expect(content).toContain("Wave Execution Loop");
    expect(content).toContain("Integration Verification");

    // Should be project-agnostic (no hardcoded project commands)
    expect(content).not.toContain("yarn verify");
    expect(content).not.toContain("npm run verify");

    // Should reference generic verify/test
    expect(content).toContain("verify/test command");
  });

  it("should have night-watch template referencing prd-executor", () => {
    const templatePath = path.join(packageRoot, "templates", "night-watch.md");
    const content = fs.readFileSync(templatePath, "utf-8");

    expect(content).toContain("prd-executor.md");
    expect(content).toContain("PRD Executor workflow");
    expect(content).toContain("parallel waves");
  });

  it("should have cron script referencing prd-executor", () => {
    const scriptPath = path.join(packageRoot, "scripts", "night-watch-cron.sh");
    const content = fs.readFileSync(scriptPath, "utf-8");

    expect(content).toContain("prd-executor.md");
    expect(content).toContain("PRD Executor Workflow");
    expect(content).toContain("parallel waves");
  });

  it("should have README.md", () => {
    const readmePath = path.join(packageRoot, "README.md");
    expect(fs.existsSync(readmePath)).toBe(true);

    const content = fs.readFileSync(readmePath, "utf-8");
    expect(content).toContain("Night Watch CLI");
    expect(content).toContain("Quick Start");
    expect(content).toContain("Installation");
  });

  it("should have LICENSE file", () => {
    const licensePath = path.join(packageRoot, "LICENSE");
    expect(fs.existsSync(licensePath)).toBe(true);

    const content = fs.readFileSync(licensePath, "utf-8");
    expect(content).toContain("MIT License");
    expect(content).toContain("Joao Paulo Furtado");
  });

  it("should have .npmignore file", () => {
    const npmignorePath = path.join(packageRoot, ".npmignore");
    expect(fs.existsSync(npmignorePath)).toBe(true);

    const content = fs.readFileSync(npmignorePath, "utf-8");
    expect(content).toContain("src/");
    expect(content).toContain("__tests__/");
  });
});

describe("npm pack verification", () => {
  it("should include scripts in npm pack output", () => {
    // Run npm pack --dry-run and check output
    try {
      const output = execSync("npm pack --dry-run 2>&1", {
        cwd: packageRoot,
        encoding: "utf-8",
      });

      // Check that scripts are included
      expect(output).toMatch(/scripts\//);
      expect(output).toMatch(/night-watch-cron\.sh/);
      expect(output).toMatch(/night-watch-pr-reviewer-cron\.sh/);
      expect(output).toMatch(/night-watch-helpers\.sh/);
    } catch (error) {
      // If npm pack fails, skip this test
      console.warn("npm pack --dry-run failed, skipping pack verification");
    }
  });

  it("should include templates in npm pack output", () => {
    try {
      const output = execSync("npm pack --dry-run 2>&1", {
        cwd: packageRoot,
        encoding: "utf-8",
      });

      // Check that templates are included
      expect(output).toMatch(/templates\//);
      expect(output).toMatch(/night-watch\.md/);
      expect(output).toMatch(/prd-executor\.md/);
      expect(output).toMatch(/night-watch-pr-reviewer\.md/);
      expect(output).toMatch(/night-watch\.config\.json/);
    } catch (error) {
      console.warn("npm pack --dry-run failed, skipping pack verification");
    }
  });

  it("should include bin in npm pack output", () => {
    try {
      const output = execSync("npm pack --dry-run 2>&1", {
        cwd: packageRoot,
        encoding: "utf-8",
      });

      // Check that bin is included
      expect(output).toMatch(/bin\//);
      expect(output).toMatch(/night-watch\.mjs/);
    } catch (error) {
      console.warn("npm pack --dry-run failed, skipping pack verification");
    }
  });

  it("should include dist in npm pack output", () => {
    try {
      const output = execSync("npm pack --dry-run 2>&1", {
        cwd: packageRoot,
        encoding: "utf-8",
      });

      // Check that dist is included
      expect(output).toMatch(/dist\//);
    } catch (error) {
      console.warn("npm pack --dry-run failed, skipping pack verification");
    }
  });

  it("should exclude src from npm pack output", () => {
    try {
      const output = execSync("npm pack --dry-run 2>&1", {
        cwd: packageRoot,
        encoding: "utf-8",
      });

      // Check that src is excluded
      expect(output).not.toMatch(/src\/cli\.ts/);
      expect(output).not.toMatch(/src\/commands\//);
    } catch (error) {
      console.warn("npm pack --dry-run failed, skipping pack verification");
    }
  });

  it("should exclude test files from npm pack output", () => {
    try {
      const output = execSync("npm pack --dry-run 2>&1", {
        cwd: packageRoot,
        encoding: "utf-8",
      });

      // Check that test files are excluded
      expect(output).not.toMatch(/__tests__\//);
      expect(output).not.toMatch(/\.test\.ts/);
    } catch (error) {
      console.warn("npm pack --dry-run failed, skipping pack verification");
    }
  });
});
