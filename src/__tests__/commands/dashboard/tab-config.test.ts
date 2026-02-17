/**
 * Tests for Config tab logic
 */

import { describe, it, expect } from "vitest";
import { CONFIG_FIELDS } from "../../../commands/dashboard/tab-config.js";

describe("tab-config", () => {
  describe("CONFIG_FIELDS", () => {
    it("should include all editable config fields", () => {
      const fieldKeys = CONFIG_FIELDS.map((f) => f.key);

      expect(fieldKeys).toContain("provider");
      expect(fieldKeys).toContain("reviewerEnabled");
      expect(fieldKeys).toContain("defaultBranch");
      expect(fieldKeys).toContain("prdDir");
      expect(fieldKeys).toContain("branchPrefix");
      expect(fieldKeys).toContain("branchPatterns");
      expect(fieldKeys).toContain("cronSchedule");
      expect(fieldKeys).toContain("reviewerSchedule");
      expect(fieldKeys).toContain("maxRuntime");
      expect(fieldKeys).toContain("reviewerMaxRuntime");
      expect(fieldKeys).toContain("minReviewScore");
      expect(fieldKeys).toContain("maxLogSize");
    });

    it("should have providerEnv as keyvalue and notifications as webhooks", () => {
      const providerEnvField = CONFIG_FIELDS.find((f) => f.key === "providerEnv");
      const notificationsField = CONFIG_FIELDS.find((f) => f.key === "notifications");

      expect(providerEnvField?.type).toBe("keyvalue");
      expect(notificationsField?.type).toBe("webhooks");
    });

    it("should have provider as enum with valid options", () => {
      const providerField = CONFIG_FIELDS.find((f) => f.key === "provider");

      expect(providerField?.type).toBe("enum");
      expect(providerField?.options).toContain("claude");
      expect(providerField?.options).toContain("codex");
    });

    it("should have reviewerEnabled as boolean", () => {
      const field = CONFIG_FIELDS.find((f) => f.key === "reviewerEnabled");
      expect(field?.type).toBe("boolean");
    });

    it("should validate maxRuntime as positive integer", () => {
      const field = CONFIG_FIELDS.find((f) => f.key === "maxRuntime");

      expect(field?.validate?.("3600")).toBeNull();
      expect(field?.validate?.("0")).not.toBeNull();
      expect(field?.validate?.("-1")).not.toBeNull();
      expect(field?.validate?.("abc")).not.toBeNull();
    });

    it("should validate minReviewScore as 0-100", () => {
      const field = CONFIG_FIELDS.find((f) => f.key === "minReviewScore");

      expect(field?.validate?.("0")).toBeNull();
      expect(field?.validate?.("80")).toBeNull();
      expect(field?.validate?.("100")).toBeNull();
      expect(field?.validate?.("-1")).not.toBeNull();
      expect(field?.validate?.("101")).not.toBeNull();
      expect(field?.validate?.("abc")).not.toBeNull();
    });

    it("should have labels for all fields", () => {
      for (const field of CONFIG_FIELDS) {
        expect(field.label).toBeTruthy();
        expect(field.label.length).toBeGreaterThan(0);
      }
    });
  });
});
