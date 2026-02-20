import { describe, expect, it } from "vitest";

import { parseScriptResult } from "../../utils/script-result.js";

describe("parseScriptResult", () => {
  it("should parse status without metadata", () => {
    const result = parseScriptResult("NIGHT_WATCH_RESULT:skip_no_eligible_prd\n");

    expect(result).toEqual({
      status: "skip_no_eligible_prd",
      data: {},
    });
  });

  it("should parse status with metadata", () => {
    const result = parseScriptResult(
      "noise\nNIGHT_WATCH_RESULT:success_open_pr|prd=01-feature.md|branch=night-watch/01-feature\n"
    );

    expect(result).toEqual({
      status: "success_open_pr",
      data: {
        prd: "01-feature.md",
        branch: "night-watch/01-feature",
      },
    });
  });

  it("should use the last marker when multiple markers exist", () => {
    const result = parseScriptResult(
      "NIGHT_WATCH_RESULT:skip_locked\nNIGHT_WATCH_RESULT:success_reviewed|prs=#11,#12\n"
    );

    expect(result).toEqual({
      status: "success_reviewed",
      data: { prs: "#11,#12" },
    });
  });

  it("should return null when no marker exists", () => {
    expect(parseScriptResult("plain output")).toBeNull();
  });
});
