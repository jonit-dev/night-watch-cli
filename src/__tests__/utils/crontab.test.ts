/**
 * Tests for crontab utility functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
import {
  readCrontab,
  writeCrontab,
  addEntry,
  removeEntries,
  removeEntriesForProject,
  hasEntry,
  getEntries,
  getProjectEntries,
  generateMarker,
  CRONTAB_MARKER_PREFIX,
} from "../../utils/crontab.js";

describe("crontab utilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateMarker", () => {
    it("should generate marker with project name", () => {
      const marker = generateMarker("my-project");
      expect(marker).toBe("# night-watch-cli: my-project");
    });

    it("should handle project names with spaces", () => {
      const marker = generateMarker("my awesome project");
      expect(marker).toBe("# night-watch-cli: my awesome project");
    });
  });

  describe("readCrontab", () => {
    it("should parse existing crontab", () => {
      const mockCrontab = `# This is a comment
0 * * * * /usr/bin/some-command
*/5 * * * * /usr/bin/another-command`;

      vi.mocked(execSync).mockReturnValueOnce(mockCrontab);

      const result = readCrontab();

      expect(result).toHaveLength(3);
      expect(result[0]).toBe("# This is a comment");
      expect(result[1]).toBe("0 * * * * /usr/bin/some-command");
      expect(result[2]).toBe("*/5 * * * * /usr/bin/another-command");
    });

    it("should handle empty crontab", () => {
      vi.mocked(execSync).mockReturnValueOnce("");

      const result = readCrontab();

      expect(result).toEqual([]);
    });

    it("should return empty array when no crontab exists", () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error("no crontab for user");
      });

      const result = readCrontab();

      expect(result).toEqual([]);
    });
  });

  describe("writeCrontab", () => {
    it("should write crontab entries", () => {
      const lines = ["0 * * * * /usr/bin/command1", "*/5 * * * * /usr/bin/command2"];

      // Mock backup attempt
      vi.mocked(execSync).mockReturnValueOnce("existing crontab");
      // Mock write
      vi.mocked(execSync).mockReturnValueOnce("");

      writeCrontab(lines);

      // Check that crontab was called with the right content
      const writeCall = vi.mocked(execSync).mock.calls[1];
      expect(writeCall[0]).toContain("crontab -");
    });
  });

  describe("addEntry", () => {
    it("should add entries without duplicates", () => {
      const marker = "# night-watch-cli: my-project";
      const entry = "0 * * * * cd /home/user && night-watch run";

      // First call: read existing crontab (empty)
      vi.mocked(execSync).mockReturnValueOnce("");
      // Second call: backup (returns nothing)
      vi.mocked(execSync).mockReturnValueOnce("");
      // Third call: write
      vi.mocked(execSync).mockReturnValueOnce("");

      const result = addEntry(entry, marker);

      expect(result).toBe(true);
    });

    it("should not add duplicate entries", () => {
      const marker = "# night-watch-cli: my-project";
      const entry = "0 * * * * cd /home/user && night-watch run";

      // Mock existing crontab with the same entry
      vi.mocked(execSync).mockReturnValueOnce(
        `0 * * * * cd /home/user && night-watch run  # night-watch-cli: my-project`
      );

      const result = addEntry(entry, marker);

      expect(result).toBe(false);
    });
  });

  describe("removeEntries", () => {
    it("should remove entries by marker", () => {
      const marker = "# night-watch-cli: my-project";

      // Mock existing crontab with entries
      vi.mocked(execSync)
        .mockReturnValueOnce(
          `0 * * * * some-command
0 * * * * night-watch run  # night-watch-cli: my-project
0 0 * * * night-watch review  # night-watch-cli: my-project`
        )
        .mockReturnValueOnce("") // backup
        .mockReturnValueOnce(""); // write

      const result = removeEntries(marker);

      expect(result).toBe(2);
    });

    it("should return 0 if no entries to remove", () => {
      const marker = "# night-watch-cli: my-project";

      // Mock crontab without the marker
      vi.mocked(execSync).mockReturnValueOnce("0 * * * * some-command");

      const result = removeEntries(marker);

      expect(result).toBe(0);
    });
  });

  describe("hasEntry", () => {
    it("should return true if entry exists", () => {
      const marker = "# night-watch-cli: my-project";

      vi.mocked(execSync).mockReturnValueOnce(
        "0 * * * * night-watch run  # night-watch-cli: my-project"
      );

      const result = hasEntry(marker);

      expect(result).toBe(true);
    });

    it("should return false if entry does not exist", () => {
      const marker = "# night-watch-cli: my-project";

      vi.mocked(execSync).mockReturnValueOnce("0 * * * * some-command");

      const result = hasEntry(marker);

      expect(result).toBe(false);
    });

    it("should return false if crontab is empty", () => {
      const marker = "# night-watch-cli: my-project";

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error("no crontab");
      });

      const result = hasEntry(marker);

      expect(result).toBe(false);
    });
  });

  describe("getEntries", () => {
    it("should get all entries with marker", () => {
      const marker = "# night-watch-cli: my-project";

      vi.mocked(execSync).mockReturnValueOnce(
        `0 * * * * some-command
0 * * * * night-watch run  # night-watch-cli: my-project
0 0 * * * night-watch review  # night-watch-cli: my-project`
      );

      const result = getEntries(marker);

      expect(result).toHaveLength(2);
      expect(result[0]).toContain("night-watch run");
      expect(result[1]).toContain("night-watch review");
    });

    it("should return empty array if no matching entries", () => {
      const marker = "# night-watch-cli: my-project";

      vi.mocked(execSync).mockReturnValueOnce("0 * * * * some-command");

      const result = getEntries(marker);

      expect(result).toEqual([]);
    });
  });

  describe("getProjectEntries", () => {
    it("should get entries by project path regardless of marker text", () => {
      const projectDir = "/home/joao/projects/autopilotrank.com";

      vi.mocked(execSync).mockReturnValueOnce(
        `0 * * * * cd /home/joao/projects/other && night-watch run  # night-watch-cli: other
0 * * * * cd /home/joao/projects/autopilotrank.com && night-watch run  # night-watch-cli: old-marker
0 0 * * * cd '/home/joao/projects/autopilotrank.com' && '/usr/bin/night-watch' review  # night-watch-cli: new-marker`
      );

      const result = getProjectEntries(projectDir);

      expect(result).toHaveLength(2);
      expect(result[0]).toContain("old-marker");
      expect(result[1]).toContain("new-marker");
    });
  });

  describe("removeEntriesForProject", () => {
    it("should remove entries by project path and marker", () => {
      const projectDir = "/home/joao/projects/autopilotrank.com";
      const marker = "# night-watch-cli: autopilotrank";

      vi.mocked(execSync)
        .mockReturnValueOnce(
          `0 * * * * cd /home/joao/projects/autopilotrank.com && night-watch run  # night-watch-cli: autopilotrank
0 0 * * * cd '/home/joao/projects/autopilotrank.com' && '/usr/bin/night-watch' review  # night-watch-cli: vite-react-typescript-starter
0 * * * * cd /home/joao/projects/other && night-watch run  # night-watch-cli: other`
        )
        .mockReturnValueOnce("") // backup
        .mockReturnValueOnce(""); // write

      const removed = removeEntriesForProject(projectDir, marker);

      expect(removed).toBe(2);
    });
  });
});
