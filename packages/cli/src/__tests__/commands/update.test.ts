import { describe, expect, it } from "vitest";
import { DEFAULT_GLOBAL_SPEC, parseProjectDirs } from "@/cli/commands/update.js";

describe("update command helpers", () => {
  it("should expose default global spec", () => {
    expect(DEFAULT_GLOBAL_SPEC).toBe("@jonit-dev/night-watch-cli@latest");
  });

  it("should default to cwd when projects are not provided", () => {
    const cwd = "/tmp/project";
    expect(parseProjectDirs(undefined, cwd)).toEqual([cwd]);
  });

  it("should parse comma-separated project directories", () => {
    const cwd = "/workspace/base";
    const dirs = parseProjectDirs(".,../a,/abs/path", cwd);
    expect(dirs).toEqual([
      "/workspace/base",
      "/workspace/a",
      "/abs/path",
    ]);
  });

  it("should de-duplicate directories after resolution", () => {
    const cwd = "/workspace/base";
    const dirs = parseProjectDirs(".,./,./", cwd);
    expect(dirs).toEqual(["/workspace/base"]);
  });
});

