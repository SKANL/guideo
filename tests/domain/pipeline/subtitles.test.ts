import { describe, expect, it } from "vitest";
import { parseScript } from "../../../src/domain/models/script.js";
import { deriveSubtitles } from "../../../src/domain/pipeline/subtitles.js";

const script = parseScript({
  segments: [
    { id: "seg-1", text: "Let's log in.", timing: { startMs: 0, durationMs: 1500 } },
    { id: "seg-2", text: "Now invite a teammate.", timing: { startMs: 1500, durationMs: 2000 } },
  ],
});

describe("deriveSubtitles", () => {
  it("derives caption text from the Script (no transcription), timed to the given per-segment duration", () => {
    // Durations here stand in for RenderContext.segmentDurationsMs — populated from real
    // synthesized audio in "voice"/"both" narration mode, or from the Script's own planned
    // timing.durationMs in "subtitles" mode (no audio at all). deriveSubtitles doesn't care which.
    const segmentDurationsMs = new Map([
      ["seg-1", 1600],
      ["seg-2", 1900],
    ]);
    const subtitles = deriveSubtitles(script, segmentDurationsMs);
    expect(subtitles).toEqual([
      { text: "Let's log in.", startMs: 0, durationMs: 1600 },
      { text: "Now invite a teammate.", startMs: 1500, durationMs: 1900 },
    ]);
  });

  it("throws when a segment has no known duration", () => {
    const segmentDurationsMs = new Map([["seg-1", 1600]]);
    expect(() => deriveSubtitles(script, segmentDurationsMs)).toThrow(/seg-2/);
  });
});
