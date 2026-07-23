import { describe, expect, it } from "vitest";
import { assertNarrationRefsResolve, parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";

const script = parseScript({
  segments: [
    { id: "seg-1", text: "Let's log in.", timing: { startMs: 0, durationMs: 1500 } },
    { id: "seg-2", text: "Enter your email.", timing: { startMs: 1500, durationMs: 2000 } },
  ],
});

describe("assertNarrationRefsResolve", () => {
  it("does not throw when every storyboard step references an existing segment", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "navigate", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });
    expect(() => assertNarrationRefsResolve(storyboard, script)).not.toThrow();
  });

  it("throws a meaningful error listing dangling narrationSegmentId references", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "navigate", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-missing" },
      ],
    });
    expect(() => assertNarrationRefsResolve(storyboard, script)).toThrow(/seg-missing/);
  });
});
