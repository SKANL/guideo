import { describe, expect, it } from "vitest";
import { FfmpegPrivacyCutter } from "../../../src/adapters/effects/cut-private-scenes.js";
import type { Audio, RawClip } from "../../../src/domain/models/media.js";
import type { Script } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { review } from "../../../src/domain/review-gate.js";

function approve(input: unknown) {
  const storyboard = parseStoryboard(input);
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

const clip: RawClip = {
  path: "clip.mp4",
  durationMs: 3300,
  aspectRatio: "16:9",
  scenes: [
    { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
    { narrationSegmentId: "s2", startMs: 1000, endMs: 1800 },
    { narrationSegmentId: "s3", startMs: 1800, endMs: 3300 },
  ],
  preRollMs: 0,
};
const script: Script = {
  segments: [
    { id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } },
    { id: "s2", text: "Two (secret).", timing: { startMs: 1000, durationMs: 800 } },
    { id: "s3", text: "Three.", timing: { startMs: 1800, durationMs: 1500 } },
  ],
};
const audioTracks: Audio[] = [
  { segmentId: "s1", path: "s1.mp3", durationMs: 1000 },
  { segmentId: "s2", path: "s2.mp3", durationMs: 800 },
  { segmentId: "s3", path: "s3.mp3", durationMs: 1500 },
];

describe("FfmpegPrivacyCutter", () => {
  it("passthrough: returns the input clip/script/audioTracks UNCHANGED and runs NO ffmpeg when no scene is private", async () => {
    const execCalls: unknown[] = [];
    const cutter = new FfmpegPrivacyCutter(async (...args) => {
      execCalls.push(args);
    });
    const approved = approve({
      steps: [
        { action: "pause", narrationSegmentId: "s1" },
        { action: "pause", narrationSegmentId: "s2" },
        { action: "pause", narrationSegmentId: "s3" },
      ],
    });

    const result = await cutter.cut(clip, approved, script, audioTracks);

    expect(result.clip).toBe(clip);
    expect(result.script).toBe(script);
    expect(result.audioTracks).toBe(audioTracks);
    expect(execCalls).toHaveLength(0);
  });

  it("runs ffmpeg with an argv array (never a shell string) when a scene is private, returning a rebased clip/script/audioTracks", async () => {
    const execCalls: { ffmpegPath: string; argv: readonly string[] }[] = [];
    const cutter = new FfmpegPrivacyCutter(async (ffmpegPath, argv) => {
      execCalls.push({ ffmpegPath, argv });
    });
    const approved = approve({
      steps: [
        { action: "pause", narrationSegmentId: "s1" },
        { action: "pause", narrationSegmentId: "s2", visibility: "private" },
        { action: "pause", narrationSegmentId: "s3" },
      ],
    });

    const result = await cutter.cut(clip, approved, script, audioTracks);

    expect(execCalls).toHaveLength(1);
    expect(Array.isArray(execCalls[0]?.argv)).toBe(true);
    expect(execCalls[0]?.argv).toContain("clip.mp4");
    expect(execCalls[0]?.argv).toContain("-filter_complex");

    expect(result.clip.path).not.toBe(clip.path);
    expect(result.clip.scenes).toEqual([
      { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
      { narrationSegmentId: "s3", startMs: 1000, endMs: 2500 },
    ]);
    expect(result.clip.durationMs).toBe(2500);
    expect(result.audioTracks).toEqual([
      { segmentId: "s1", path: "s1.mp3", durationMs: 1000 },
      { segmentId: "s3", path: "s3.mp3", durationMs: 1500 },
    ]);
    expect(result.script.segments).toEqual([
      { id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } },
      { id: "s3", text: "Three.", timing: { startMs: 1000, durationMs: 1500 } },
    ]);
  });
});
