import { describe, expect, it } from "@jest/globals";
import { getNextActionSuggestion } from "../../tools/board-summary.js";

describe("getNextActionSuggestion", () => {
  it("prioritizes Testing when there are cards in Testing", () => {
    expect(getNextActionSuggestion(5, 5, 1)).toBe(
      "Review cards in Testing that need feedback",
    );
  });

  it("suggests In Progress when Testing is empty but In Progress is not", () => {
    expect(getNextActionSuggestion(5, 2, 0)).toBe(
      "Continue working on cards in In Progress",
    );
  });

  it("suggests Backlog when only Backlog has cards", () => {
    expect(getNextActionSuggestion(3, 0, 0)).toBe(
      "Start working on a card from Backlog",
    );
  });

  it("reports completion when every tracked list is empty", () => {
    expect(getNextActionSuggestion(0, 0, 0)).toBe(
      "All tasks complete! Create new cards or projects",
    );
  });
});
