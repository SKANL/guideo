import { describe, expect, it } from "vitest";
import {
  type ApprovedStoryboard,
  parseStoryboard,
  type Storyboard,
} from "../../../src/domain/models/storyboard.js";

function requiresApprovedStoryboard(_storyboard: ApprovedStoryboard): void {
  // domain code (Phase 3+) would only be reachable once a Storyboard has been minted
  // into an ApprovedStoryboard by the ReviewGate.
}

describe("ApprovedStoryboard branding", () => {
  it("does not allow a plain Storyboard to satisfy ApprovedStoryboard without an explicit cast", () => {
    const rawStoryboard: Storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });

    // @ts-expect-error - a raw Storyboard is not assignable to ApprovedStoryboard; only the
    // (Phase 3) ReviewGate mint is allowed to produce one.
    requiresApprovedStoryboard(rawStoryboard);

    // Runtime sanity: structurally, an approved storyboard still parses as a plain Storyboard
    // (the brand is compile-time only), proven here via an unsafe cast at the test boundary.
    const mintedForTest = rawStoryboard as ApprovedStoryboard;
    expect(mintedForTest.steps).toHaveLength(1);
  });
});
