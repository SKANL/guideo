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
  // Regression: subtitles used to be timed off a cumulative sum of PLANNED/audio segment
  // durations, but capture only paces UP to that target — click+navigation makes a scene
  // overshoot it, so the real on-screen scene runs longer than planned. That drift compounds
  // across scenes, landing subtitles ~1 scene ahead of the video. Fix: time subtitles to the
  // ASSEMBLED clip's REAL per-scene ranges instead.
  it("times each subtitle to the matching scene's REAL [startMs,endMs], not a cumulative sum of planned durations", () => {
    // Planned timing above says seg-1 ends at 1500ms, but the real assembled scene for seg-1
    // overshot to 1800ms (pushing seg-2's real start to 1800ms too).
    const scenes = [
      { narrationSegmentId: "seg-1", startMs: 0, endMs: 1800 },
      { narrationSegmentId: "seg-2", startMs: 1800, endMs: 3700 },
    ];
    const subtitles = deriveSubtitles(script, scenes);
    expect(subtitles).toEqual([
      { text: "Let's log in.", startMs: 0, durationMs: 1800 },
      { text: "Now invite a teammate.", startMs: 1800, durationMs: 1900 },
    ]);
  });

  it("skips a segment with no matching scene (e.g. privacy-cut) instead of throwing", () => {
    const scenes = [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1500 }];
    const subtitles = deriveSubtitles(script, scenes);
    expect(subtitles).toEqual([{ text: "Let's log in.", startMs: 0, durationMs: 1500 }]);
  });

  it("splits a long caption into readable, sequential cues with at most two lines each", () => {
    const longScript = parseScript({
      segments: [{
        id: "seg-1",
        text: "Open the menu, choose the team workspace, and then select the member you want to invite today.",
        timing: { startMs: 0, durationMs: 5000 },
      }],
    });

    const subtitles = deriveSubtitles(longScript, [{ narrationSegmentId: "seg-1", startMs: 1000, endMs: 6000 }]);

    expect(subtitles.length).toBeGreaterThan(1);
    expect(subtitles.every((subtitle) => subtitle.text.split("\n").length <= 2)).toBe(true);
    expect(subtitles[0]).toMatchObject({ startMs: 1000 });
    expect(subtitles.at(-1)!.startMs + subtitles.at(-1)!.durationMs).toBe(6000);
    expect(subtitles.slice(1).every((subtitle, index) => subtitle.startMs === subtitles[index]!.startMs + subtitles[index]!.durationMs)).toBe(true);
  });
});
