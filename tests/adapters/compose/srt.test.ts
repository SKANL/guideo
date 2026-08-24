import { describe, expect, it } from "vitest";
import { toSrt } from "../../../src/adapters/compose/srt.js";
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
        "{\\an2\\fs18\\bord1\\shad1}Let's log in.",
        "",
        "2",
        "00:01:05,250 --> 00:01:07,250",
        "{\\an2\\fs18\\bord1\\shad1}Click submit.",
        "",
      ].join("\n"),
    );
  });

  it("adds a compact, bottom-safe presentation style to every cue", () => {
    expect(toSrt([{ text: "Caption", startMs: 0, durationMs: 1000 }])).toContain(
      "{\\an2\\fs18\\bord1\\shad1}",
    );
  });
});
