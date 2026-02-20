import * as fs from "fs";
import { describe, expect, it } from "vitest";
import {
  acquireServeLock,
  getServeLockPath,
  releaseServeLock,
} from "../../commands/serve.js";

function uniquePort(seed: number): number {
  const base = 43000;
  const pidOffset = process.pid % 1000;
  return base + pidOffset + seed;
}

describe("serve command lock", () => {
  it("acquires and releases a lock", () => {
    const port = uniquePort(1);
    const lockPath = getServeLockPath("global", port);
    try {
      const result = acquireServeLock("global", port);
      expect(result.acquired).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(true);
    } finally {
      releaseServeLock(lockPath);
    }

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("rejects duplicate serve process for same mode+port", () => {
    const port = uniquePort(2);
    const lockPath = getServeLockPath("global", port);

    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, "utf-8");
      const result = acquireServeLock("global", port);
      expect(result.acquired).toBe(false);
      expect(result.existingPid).toBe(process.pid);
    } finally {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    }
  });

  it("cleans stale lock and acquires", () => {
    const port = uniquePort(3);
    const lockPath = getServeLockPath("local", port);

    try {
      fs.writeFileSync(lockPath, "99999999\n", "utf-8");
      const result = acquireServeLock("local", port);
      expect(result.acquired).toBe(true);
      expect(result.stalePidCleaned).toBe(99999999);
      expect(fs.existsSync(lockPath)).toBe(true);
    } finally {
      releaseServeLock(lockPath);
    }

    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

