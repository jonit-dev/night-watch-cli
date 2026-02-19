import { describe, it, expect } from "vitest";
import { BOARD_COLUMNS } from "@/board/types.js";

describe("BOARD_COLUMNS", () => {
  it("has correct order", () => {
    expect(BOARD_COLUMNS).toEqual(["Draft", "Ready", "In Progress", "Review", "Done"]);
    expect(BOARD_COLUMNS).toHaveLength(5);
  });
});
