import { describe, expect, it } from "vitest";
import { FfmpegPreRollTrimmer } from "../../../src/adapters/effects/trim-preroll.js";
import type { RawClip } from "../../../src/domain/models/media.js";

const clip: RawClip = {
  path: "clip.mp4",
  durationMs: 1000,
  aspectRatio: "16:9",
  scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
  preRollMs: 600,
};

describe("FfmpegPreRollTrimmer", () => {
  it("passthrough: returns the input clip unchanged and runs NO ffmpeg when preRollMs is 0", async () => {
    const execCalls: unknown[] = [];
    const trimmer = new FfmpegPreRollTrimmer(async (...args) => {
      execCalls.push(args);
    });

    const zeroPreRollClip = { ...clip, preRollMs: 0 };
    const result = await trimmer.trim(zeroPreRollClip, 0);

    expect(result).toBe(zeroPreRollClip);
    expect(execCalls).toHaveLength(0);
  });

  it("runs ffmpeg with an argv array (never a shell string) when preRollMs > 0, and returns a new clip with preRollMs reset to 0", async () => {
    const execCalls: { ffmpegPath: string; argv: readonly string[] }[] = [];
    const trimmer = new FfmpegPreRollTrimmer(async (ffmpegPath, argv) => {
      execCalls.push({ ffmpegPath, argv });
    });

    const result = await trimmer.trim(clip, 600);

    expect(execCalls).toHaveLength(1);
    expect(Array.isArray(execCalls[0]?.argv)).toBe(true);
    expect(execCalls[0]?.argv).toContain("clip.mp4");
    expect(execCalls[0]?.argv).toContain("-ss");
    expect(execCalls[0]?.argv).toContain("0.600");
    expect(result.path).not.toBe(clip.path);
    expect(result.preRollMs).toBe(0);
    // Scene ranges and durationMs are unaffected by the trim — they were already 0-based/scene-
    // only (see WebRecordingEngine.capture()); the trim only removes footage BEFORE scene 0.
    expect(result.durationMs).toBe(clip.durationMs);
    expect(result.scenes).toBe(clip.scenes);
  });
});
