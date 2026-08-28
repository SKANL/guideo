import { describe, expect, it } from "vitest";
import { parseScript } from "../../../src/domain/models/script.js";
import { deriveSubtitles } from "../../../src/domain/pipeline/subtitles.js";

describe("deriveSubtitles speech timing", () => {
  it("uses provider word boundaries to keep phrase cues aligned with spoken words", () => {
    const script = parseScript({ segments: [{ id: "s1", text: "Open settings, then save changes.", timing: { startMs: 0, durationMs: 4_000 } }] });
    const subtitles = deriveSubtitles(script, [{ narrationSegmentId: "s1", startMs: 0, endMs: 4_000 }], {}, [{ segmentId: "s1", approximate: false, words: [
      { text: "Open", startMs: 100, endMs: 400 }, { text: "settings,", startMs: 400, endMs: 900 }, { text: "then", startMs: 1_500, endMs: 1_800 }, { text: "save", startMs: 1_800, endMs: 2_100 }, { text: "changes.", startMs: 2_100, endMs: 2_700 },
    ] }]);

    expect(subtitles).toMatchObject([
      { text: "Open settings,", startMs: 100, durationMs: 800 },
      { text: "then save changes.", startMs: 1_500, durationMs: 1_200 },
    ]);
  });

  it("falls back deterministically when only approximate timing exists and keeps two-line readable cues", () => {
    const script = parseScript({ segments: [{ id: "s1", text: "Open settings, then save changes.", timing: { startMs: 0, durationMs: 4_000 } }] });
    const subtitles = deriveSubtitles(script, [{ narrationSegmentId: "s1", startMs: 0, endMs: 4_000 }], {}, [{ segmentId: "s1", approximate: true, words: [] }]);

    expect(subtitles[0]).toMatchObject({ text: "Open settings,", startMs: 0 });
    expect(subtitles.at(-1)!.startMs + subtitles.at(-1)!.durationMs).toBe(4_000);
    expect(subtitles.every((cue) => cue.text.split("\n").length <= 2)).toBe(true);
  });

  it("keeps word-timed phrase boundaries so a caption never exceeds two lines", () => {
    const script = parseScript({ segments: [{ id: "s1", text: "Click now, then save.", timing: { startMs: 0, durationMs: 2_000 } }] });
    const subtitles = deriveSubtitles(script, [{ narrationSegmentId: "s1", startMs: 0, endMs: 2_000 }], {}, [{ segmentId: "s1", approximate: false, words: [
      { text: "Click", startMs: 0, endMs: 100 }, { text: "now,", startMs: 100, endMs: 250 }, { text: "then", startMs: 250, endMs: 500 }, { text: "save.", startMs: 500, endMs: 1_500 },
    ] }]);

    expect(subtitles).toMatchObject([
      { text: "Click now,", startMs: 0, durationMs: 250 },
      { text: "then save.", startMs: 250, durationMs: 1_250 },
    ]);
    expect(subtitles.every((cue) => cue.text.split("\n").length <= 2)).toBe(true);
  });

  it("clamps provider cues to their scene ranges and removes caption overlap deterministically", () => {
    const script = parseScript({ segments: [
      { id: "s1", text: "Open settings, then save.", timing: { startMs: 0, durationMs: 4_500 } },
      { id: "s2", text: "Confirm changes.", timing: { startMs: 4_500, durationMs: 2_000 } },
    ] });
    const subtitles = deriveSubtitles(script, [
      { narrationSegmentId: "s1", startMs: 0, endMs: 4_500 },
      { narrationSegmentId: "s2", startMs: 4_500, endMs: 6_500 },
    ], {}, [
      { segmentId: "s1", approximate: false, words: [
        { text: "Open", startMs: 0, endMs: 1_000 }, { text: "settings,", startMs: 1_000, endMs: 8_916 },
        { text: "then", startMs: 2_000, endMs: 2_500 }, { text: "save.", startMs: 2_500, endMs: 3_000 },
      ] },
      { segmentId: "s2", approximate: false, words: [
        { text: "Confirm", startMs: 4_400, endMs: 5_000 }, { text: "changes.", startMs: 5_000, endMs: 5_500 },
      ] },
    ]);

    expect(subtitles).toMatchObject([
      { text: "Open settings,", startMs: 0, durationMs: 4_500 },
      { text: "Confirm changes.", startMs: 4_500, durationMs: 1_000 },
    ]);
    expect(subtitles.slice(1).every((cue, index) => {
      const previous = subtitles[index];
      return previous !== undefined && previous.startMs + previous.durationMs <= cue.startMs;
    })).toBe(true);
  });
});
