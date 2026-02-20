/**
 * Tests for Schedules tab logic
 */

import { describe, it, expect } from "vitest";
import { cronToHuman, SCHEDULE_PRESETS } from "@/cli/commands/dashboard/tab-schedules.js";

describe("tab-schedules", () => {
  describe("cronToHuman (cronstrue)", () => {
    it("should parse every minute", () => {
      expect(cronToHuman("* * * * *")).toBe("Every minute");
    });

    it("should parse every N minutes", () => {
      expect(cronToHuman("*/5 * * * *")).toBe("Every 5 minutes");
      expect(cronToHuman("*/15 * * * *")).toBe("Every 15 minutes");
    });

    it("should parse every N hours", () => {
      expect(cronToHuman("0 */3 * * *")).toBe("On the hour, every 3 hours");
      expect(cronToHuman("0 */6 * * *")).toBe("On the hour, every 6 hours");
    });

    it("should parse hourly with range", () => {
      expect(cronToHuman("0 0-21 * * *")).toBe("Every hour, between 00:00 and 21:00");
      expect(cronToHuman("0 9-17 * * *")).toBe("Every hour, between 09:00 and 17:00");
    });

    it("should parse hour list", () => {
      expect(cronToHuman("0 0,3,6,9,12,15,18,21 * * *")).toBe(
        "At 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00"
      );
      expect(cronToHuman("0 0,6,12,18 * * *")).toBe("At 00:00, 06:00, 12:00 and 18:00");
    });

    it("should parse daily at specific time", () => {
      expect(cronToHuman("30 14 * * *")).toBe("At 14:30");
    });

    it("should parse single hour", () => {
      expect(cronToHuman("0 9 * * *")).toBe("At 09:00");
    });

    it("should parse complex patterns with day-of-week", () => {
      expect(cronToHuman("0 9 * * 1-5")).toBe("At 09:00, Monday through Friday");
    });

    it("should parse day-of-month patterns", () => {
      expect(cronToHuman("0 0 1 * *")).toBe("At 00:00, on day 1 of the month");
    });

    it("should handle invalid expressions gracefully", () => {
      expect(cronToHuman("not a cron")).toBe("not a cron");
      expect(cronToHuman("")).toBe("");
    });
  });

  describe("SCHEDULE_PRESETS", () => {
    it("should have at least 5 presets", () => {
      expect(SCHEDULE_PRESETS.length).toBeGreaterThanOrEqual(5);
    });

    it("should have valid cron expressions (5 fields)", () => {
      for (const preset of SCHEDULE_PRESETS) {
        expect(preset.cron.split(/\s+/).length).toBe(5);
        expect(preset.label.length).toBeGreaterThan(0);
      }
    });

    it("should include common schedules", () => {
      const crons = SCHEDULE_PRESETS.map((p) => p.cron);
      expect(crons).toContain("0 * * * *"); // hourly
      expect(crons).toContain("0 */3 * * *"); // every 3 hours
      expect(crons).toContain("0 0 * * *"); // daily
    });
  });
});
