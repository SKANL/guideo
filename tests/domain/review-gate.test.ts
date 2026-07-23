import { describe, expect, it } from "vitest";
import { parseStoryboard } from "../../src/domain/models/storyboard.js";
import { review } from "../../src/domain/review-gate.js";

const storyboard = parseStoryboard({
  steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
});

describe("review-gate", () => {
  it("mints an ApprovedStoryboard on approval", () => {
    const approved = review(storyboard, { kind: "approved" });
    expect(approved).not.toBeNull();
    expect(approved?.steps).toEqual(storyboard.steps);
  });

  it("does not mint on rejection — pipeline halts", () => {
    const approved = review(storyboard, { kind: "rejected", reason: "narration is off-brand" });
    expect(approved).toBeNull();
  });
});
