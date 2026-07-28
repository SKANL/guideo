import { describe, expect, it } from "vitest";
import type { RawClip } from "../../../src/domain/models/media.js";
import {
  type ApprovedStoryboard,
  parseStoryboard,
  type Storyboard,
} from "../../../src/domain/models/storyboard.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";

class FakeRecordingEngine implements RecordingEngine {
  async capture(_storyboard: ApprovedStoryboard): Promise<RawClip> {
    return { path: "clip.mp4", durationMs: 1000, aspectRatio: "16:9", scenes: [] };
  }
}

describe("RecordingEngine port", () => {
  it("captures an ApprovedStoryboard and resolves a RawClip", async () => {
    const engine: RecordingEngine = new FakeRecordingEngine();
    const storyboard: Storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    // Test-only unsafe cast, mirrors approved-storyboard.test.ts — real minting is ReviewGate's job.
    const approved = storyboard as ApprovedStoryboard;
    const clip = await engine.capture(approved);
    expect(clip.aspectRatio).toBe("16:9");
  });

  it("rejects capture() called with a plain Storyboard at compile time", () => {
    const engine: RecordingEngine = new FakeRecordingEngine();
    const storyboard: Storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    // @ts-expect-error - capture() requires ApprovedStoryboard, not a plain Storyboard; this is
    // the compile-time hard-stop realizing the spec's REVIEW gate (no capture before approval).
    void engine.capture(storyboard);
  });
});
