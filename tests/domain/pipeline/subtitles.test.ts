import { describe, expect, it } from "vitest";
import { parseScript } from "../../../src/domain/models/script.js";
import { captionLayoutHintsFromResolvedEffects, deriveSubtitles } from "../../../src/domain/pipeline/subtitles.js";
import { resolveRenderProfile } from "../../../src/adapters/compose/render-profile.js";

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

  it("prefers phrase boundaries before hard wrapping into short rhythmic cues", () => {
    const rhythmicScript = parseScript({
      segments: [{
        id: "seg-1",
        text: "Open the menu, then choose the team workspace. Finally, select the member to invite.",
        timing: { startMs: 0, durationMs: 6000 },
      }],
    });

    const subtitles = deriveSubtitles(rhythmicScript, [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 6000 }]);

    expect(subtitles.length).toBeGreaterThanOrEqual(3);
    expect(subtitles.map((subtitle) => subtitle.text.replace("\n", " ")).join(" ")).toBe(
      "Open the menu, then choose the team workspace. Finally, select the member to invite.",
    );
    expect(subtitles.every((subtitle) => subtitle.text.split("\n").every((line) => line.length <= 26))).toBe(true);
    expect(subtitles.every((subtitle) => subtitle.text.split("\n").length <= 2)).toBe(true);
  });

  it("keeps word-timed captions within two rendered lines while preserving their safe placement", () => {
    const text = "Open the menu and choose the team workspace before inviting your next teammate.";
    const words = text.split(" ").map((word, index) => ({
      text: word,
      startMs: index * 250,
      endMs: (index + 1) * 250,
    }));
    const timedScript = parseScript({
      segments: [{ id: "seg-1", text, timing: { startMs: 0, durationMs: 3000 } }],
    });

    const subtitles = deriveSubtitles(
      timedScript,
      [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 3000 }],
      { occupiedRegions: [{ x: 0, y: 430, w: 1280, h: 290 }] },
      [{ segmentId: "seg-1", approximate: false, words }],
    );

    expect(subtitles).not.toHaveLength(0);
    expect(subtitles.every((subtitle) => subtitle.text.split("\n").length <= 2)).toBe(true);
    expect(subtitles.some((subtitle) => subtitle.text.includes("\n"))).toBe(true);
    expect(subtitles.every((subtitle) => subtitle.placement === "top")).toBe(true);
  });

  it("keeps captions compact and selects a non-overlapping safe placement when the lower third is occupied", () => {
    const subtitles = deriveSubtitles(
      script,
      [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1500 }],
      { occupiedRegions: [{ x: 0, y: 430, w: 1280, h: 290 }] },
    );

    expect(subtitles[0]).toMatchObject({ placement: "top" });
    expect(subtitles[0]?.text.split("\n")).toHaveLength(1);
  });

  it("derives occupied regions per narration segment from capture-resolved effects", () => {
    const hints = captionLayoutHintsFromResolvedEffects([
      { narrationSegmentId: "seg-1", type: "crop", region: { x: 0, y: 430, w: 1280, h: 290 } },
      { narrationSegmentId: "seg-2", type: "crop", region: { x: 10, y: 10, w: 30, h: 30 } },
    ]);

    expect(deriveSubtitles(script, [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1500 }], hints.get("seg-1"))).toMatchObject([
      { placement: "top" },
    ]);
  });

  it.each(["youtube", "shorts", "square"] as const)("derives a viewport-bounded lower-third safe region for the %s render profile", (profileName) => {
    const viewport = resolveRenderProfile(profileName).viewport;
    const subtitles = deriveSubtitles(
      script,
      [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1500 }],
      { viewport },
    );

    expect(subtitles[0]).toMatchObject({ placement: "lower-third" });
  });

  it("uses the least-occupied profile-safe region in a deterministic order", () => {
    const viewport = resolveRenderProfile("shorts").viewport;
    const occupiedRegions = [
      { x: 0, y: 1_250, w: viewport.width, h: 670 },
      { x: 0, y: 0, w: viewport.width, h: 520 },
      { x: 0, y: 1_250, w: 540, h: 670 },
    ];

    const first = deriveSubtitles(script, [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1500 }], { viewport, occupiedRegions });
    const second = deriveSubtitles(script, [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1500 }], { viewport, occupiedRegions: [...occupiedRegions].reverse() });

    expect(first[0]).toMatchObject({ placement: "bottom-right" });
    expect(second).toEqual(first);
  });
});
