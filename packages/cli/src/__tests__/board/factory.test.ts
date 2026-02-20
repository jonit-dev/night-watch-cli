import { describe, it, expect } from "vitest";
import { createBoardProvider } from "@night-watch/core/board/factory.js";

describe("createBoardProvider", () => {
  it("should throw for unsupported provider", () => {
    expect(() =>
      createBoardProvider(
        { enabled: true, provider: "jira" as any },
        "/tmp"
      )
    ).toThrow("Unsupported board provider");
  });
});
