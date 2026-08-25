import { describe, expect, it } from "vitest";
import { toSrt } from "../../../src/adapters/compose/srt.js";
import { SHORTS_RENDER_PROFILE } from "../../../src/adapters/compose/render-profile.js";
import type { Subtitle } from "../../../src/domain/models/media.js";

describe("toSrt", () => {
  it("formats subtitles as sequential numbered SRT cues with HH:MM:SS,mmm timestamps", () => {
    const subtitles: readonly Subtitle[] = [
      { text: "Let's log in.", startMs: 0, durationMs: 1500 },
      { text: "Click submit.", startMs: 65_250, durationMs: 2000 },
    ];

    expect(toSrt(subtitles)).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:01,500",
        "{\\an2\\pos(640,630)\\q2\\fs10\\bord0.8\\shad0}Let's log in.",
        "",
        "2",
        "00:01:05,250 --> 00:01:07,250",
        "{\\an2\\pos(640,630)\\q2\\fs10\\bord0.8\\shad0}Click submit.",
        "",
      ].join("\n"),
    );
  });

  it("adds a compact, bottom-safe presentation style to every cue", () => {
    expect(toSrt([{ text: "Caption", startMs: 0, durationMs: 1000 }])).toContain(
      "{\\an2\\pos(640,630)\\q2\\fs10\\bord0.8\\shad0}",
    );
  });

  it("uses the cue's deterministic safe placement rather than always centering over the UI", () => {
    expect(toSrt([{ text: "Caption", startMs: 0, durationMs: 1000, placement: "top" }])).toContain(
      "{\\an8\\pos(640,40)\\q2\\fs10\\bord0.8\\shad0}",
    );
  });

  it("serializes Shorts captions into two explicit lines per cue and preserves the Shorts safe zone", () => {
    const srt = toSrt([
      { text: "Open the menu and choose the team workspace before inviting your next teammate today.", startMs: 0, durationMs: 4_000, placement: "top" },
    ], SHORTS_RENDER_PROFILE);

    const cues = srt.trim().split(/\n\n/);
    expect(cues).toHaveLength(2);
    expect(cues.every((cue) => (cue.match(/\\N/g) ?? []).length <= 1)).toBe(true);
    expect(cues.every((cue) => cue.includes("\\q2\\fs7\\bord0.7"))).toBe(true);
    expect(cues.every((cue) => cue.includes("\\an8\\pos(540,160)"))).toBe(true);
  });
});
