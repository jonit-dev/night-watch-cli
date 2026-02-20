/**
 * Tests for UI utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chalk to disable colors for easier assertions
vi.mock("chalk", () => ({
  default: {
    green: (msg: string) => msg,
    red: (msg: string) => msg,
    yellow: (msg: string) => msg,
    cyan: (msg: string) => msg,
    dim: (msg: string) => msg,
    bold: (msg: string) => msg,
  },
  green: (msg: string) => msg,
  red: (msg: string) => msg,
  yellow: (msg: string) => msg,
  cyan: (msg: string) => msg,
  dim: (msg: string) => msg,
  bold: (msg: string) => msg,
}));

// Import after mocking
import {
  success,
  error,
  warn,
  info,
  header,
  dim,
  label,
  createSpinner,
  createTable,
  formatRunningStatus,
  formatInstalledStatus,
  step,
} from "../../utils/ui.js";

describe("UI utilities", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("success()", () => {
    it("should prefix with green check", () => {
      success("works");
      expect(consoleSpy).toHaveBeenCalledWith("✔", "works");
    });
  });

  describe("error()", () => {
    it("should prefix with red cross", () => {
      error("fail");
      expect(consoleSpy).toHaveBeenCalledWith("✖", "fail");
    });
  });

  describe("warn()", () => {
    it("should prefix with yellow warning", () => {
      warn("caution");
      expect(consoleSpy).toHaveBeenCalledWith("⚠", "caution");
    });
  });

  describe("info()", () => {
    it("should prefix with cyan info", () => {
      info("note");
      expect(consoleSpy).toHaveBeenCalledWith("ℹ", "note");
    });
  });

  describe("header()", () => {
    it("should include bold title", () => {
      header("Configuration");
      expect(consoleSpy).toHaveBeenCalled();

      // Check that title is in the output
      const calls = consoleSpy.mock.calls;
      const titleCall = calls.find((call) => call[0] === "Configuration");
      expect(titleCall).toBeDefined();
    });

    it("should include a line separator", () => {
      header("Test");
      const calls = consoleSpy.mock.calls;
      const lineCall = calls.find((call) => typeof call[0] === "string" && call[0].includes("─"));
      expect(lineCall).toBeDefined();
    });
  });

  describe("dim()", () => {
    it("should print dimmed text", () => {
      dim("secondary info");
      expect(consoleSpy).toHaveBeenCalledWith("secondary info");
    });
  });

  describe("label()", () => {
    it("should format key-value pair with padding", () => {
      label("Provider", "claude");
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("Provider");
      expect(output).toContain("claude");
    });
  });

  describe("createSpinner()", () => {
    it("should return an Ora instance", () => {
      const spinner = createSpinner("Loading...");
      expect(spinner).toBeDefined();
      expect(typeof spinner.start).toBe("function");
      expect(typeof spinner.succeed).toBe("function");
      expect(typeof spinner.fail).toBe("function");
    });
  });

  describe("createTable()", () => {
    it("should return a Table instance", () => {
      const table = createTable();
      expect(table).toBeDefined();
      expect(typeof table.push).toBe("function");
      expect(typeof table.toString).toBe("function");
    });

    it("should accept custom options", () => {
      const table = createTable({ head: ["Col1", "Col2"] });
      expect(table).toBeDefined();
    });
  });

  describe("formatRunningStatus()", () => {
    it("should return green running status with PID when running", () => {
      const result = formatRunningStatus(true, 12345);
      expect(result).toContain("Running");
      expect(result).toContain("12345");
    });

    it("should return dim stale lock status when not running but has PID", () => {
      const result = formatRunningStatus(false, 12345);
      expect(result).toContain("Stale lock");
      expect(result).toContain("12345");
    });

    it("should return dim not running status when not running and no PID", () => {
      const result = formatRunningStatus(false, null);
      expect(result).toContain("Not running");
    });
  });

  describe("formatInstalledStatus()", () => {
    it("should return green installed status when installed", () => {
      const result = formatInstalledStatus(true);
      expect(result).toContain("Installed");
    });

    it("should return yellow not installed status when not installed", () => {
      const result = formatInstalledStatus(false);
      expect(result).toContain("Not installed");
    });
  });

  describe("step()", () => {
    it("should format step with current/total prefix", () => {
      step(1, 9, "Checking git repository...");
      const output = consoleSpy.mock.calls[0];
      expect(output[0]).toContain("1");
      expect(output[0]).toContain("9");
      expect(output[1]).toBe("Checking git repository...");
    });
  });
});
