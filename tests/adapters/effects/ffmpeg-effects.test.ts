import { describe, expect, it } from "vitest";
import { FfmpegEffectsEngine } from "../../../src/adapters/effects/ffmpeg-effects.js";
import type { RawClip } from "../../../src/domain/models/media.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { review } from "../../../src/domain/review-gate.js";

function approve(input: unknown) {
  const storyboard = parseStoryboard(input);
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

describe("FfmpegEffectsEngine", () => {
  it("passthrough: returns the input clip unchanged and runs NO ffmpeg when no step has effects", async () => {
    const execCalls: unknown[] = [];
    const engine = new FfmpegEffectsEngine(async (...args) => {
      execCalls.push(args);
    });
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
    };
    const approved = approve({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });

    const result = await engine.apply(clip, approved);

    expect(result).toBe(clip);
    expect(execCalls).toHaveLength(0);
  });

  it("runs ffmpeg with an argv array (never a shell string) when an effect is present, and returns a new clip with the same scenes metadata", async () => {
    const execCalls: { ffmpegPath: string; argv: readonly string[] }[] = [];
    const engine = new FfmpegEffectsEngine(async (ffmpegPath, argv) => {
      execCalls.push({ ffmpegPath, argv });
    });
    const scenes = [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }];
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes,
      preRollMs: 0,
    };
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [{ type: "zoom-in", params: {} }],
        },
      ],
    });

    const result = await engine.apply(clip, approved);

    expect(execCalls).toHaveLength(1);
    expect(Array.isArray(execCalls[0]?.argv)).toBe(true);
    expect(execCalls[0]?.argv).toContain("clip.mp4");
    expect(execCalls[0]?.argv).toContain("-filter_complex");
    expect(result.path).not.toBe(clip.path);
    expect(result.durationMs).toBe(clip.durationMs);
    expect(result.aspectRatio).toBe(clip.aspectRatio);
    expect(result.scenes).toBe(scenes);
  });
});
