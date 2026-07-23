import { describe, expect, it } from "vitest";
import type { Audio } from "../../../src/domain/models/media.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { deriveSubtitles } from "../../../src/domain/pipeline/subtitles.js";

const script = parseScript({
  segments: [
    { id: "seg-1", text: "Let's log in.", timing: { startMs: 0, durationMs: 1500 } },
    { id: "seg-2", text: "Now invite a teammate.", timing: { startMs: 1500, durationMs: 2000 } },
  ],
});

describe("deriveSubtitles", () => {
  it("derives caption text from the Script (no transcription), timed to the actual audio duration", () => {
    const audioTracks: Audio[] = [
      { segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1600 },
      { segmentId: "seg-2", path: "seg-2.mp3", durationMs: 1900 },
    ];
    const subtitles = deriveSubtitles(script, audioTracks);
    expect(subtitles).toEqual([
      { text: "Let's log in.", startMs: 0, durationMs: 1600 },
      { text: "Now invite a teammate.", startMs: 1500, durationMs: 1900 },
    ]);
  });

  it("throws when a segment has no synthesized audio", () => {
    const audioTracks: Audio[] = [{ segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1600 }];
    expect(() => deriveSubtitles(script, audioTracks)).toThrow(/seg-2/);
  });
});
