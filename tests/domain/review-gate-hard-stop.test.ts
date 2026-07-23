import { describe, expect, it } from "vitest";
import type { RawClip } from "../../src/domain/models/media.js";
import { type ApprovedStoryboard, parseStoryboard } from "../../src/domain/models/storyboard.js";
import type { RecordingEngine } from "../../src/domain/ports/recording-engine.js";
import { review } from "../../src/domain/review-gate.js";

class FakeRecordingEngine implements RecordingEngine {
  async capture(_storyboard: ApprovedStoryboard): Promise<RawClip> {
    return { path: "clip.mp4", durationMs: 1000, aspectRatio: "16:9" };
  }
}

describe("review-gate hard stop", () => {
  it("blocks capture() until review() approval has been narrowed away from null", async () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const engine: RecordingEngine = new FakeRecordingEngine();
    const decision = review(storyboard, { kind: "approved" });

    // @ts-expect-error - review()'s return type is `ApprovedStoryboard | null`; capture() cannot
    // be called without first narrowing away `null`. This is the compile-time REVIEW-gate hard
    // stop: no code path reaches capture() without an explicit, checked approval decision.
    void engine.capture(decision);

    if (decision === null) {
      throw new Error("expected approval to mint an ApprovedStoryboard");
    }
    const clip = await engine.capture(decision);
    expect(clip.path).toBe("clip.mp4");
  });

  it("rejection means no code path can reach capture() — decision narrows to null only", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const rejected = review(storyboard, { kind: "rejected" });
    expect(rejected).toBeNull();
  });
});
