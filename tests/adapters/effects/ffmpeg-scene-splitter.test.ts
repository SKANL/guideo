import { describe, expect, it } from "vitest";
import { FfmpegSceneSplitter } from "../../../src/adapters/effects/ffmpeg-scene-splitter.js";
import type { RawClip } from "../../../src/domain/models/media.js";

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

describe("FfmpegSceneSplitter", () => {
  it("extracts one scene clip per range, in order, running ffmpeg once per scene with an argv array", async () => {
    const execCalls: { ffmpegPath: string; argv: readonly string[] }[] = [];
    const splitter = new FfmpegSceneSplitter(async (ffmpegPath, argv) => {
      execCalls.push({ ffmpegPath, argv });
    });

    const sceneClips = await splitter.split(clip);

    expect(execCalls).toHaveLength(3);
    for (const call of execCalls) {
      expect(Array.isArray(call.argv)).toBe(true);
      expect(call.argv).toContain("clip.mp4");
      expect(call.argv).toContain("-vf");
    }

    expect(sceneClips.map((c) => c.narrationSegmentId)).toEqual(["s1", "s2", "s3"]);
    expect(sceneClips.map((c) => c.durationMs)).toEqual([1000, 800, 1500]);
    expect(new Set(sceneClips.map((c) => c.path)).size).toBe(3);
  });

  it("builds a trim range matching each scene's own [startMs,endMs) window", async () => {
    const execCalls: { argv: readonly string[] }[] = [];
    const splitter = new FfmpegSceneSplitter(async (_ffmpegPath, argv) => {
      execCalls.push({ argv });
    });

    await splitter.split(clip);

    const filter0 = execCalls[0]?.argv[execCalls[0].argv.indexOf("-vf") + 1];
    expect(filter0).toBe("trim=start=0.000:end=1.000,setpts=PTS-STARTPTS");
    const filter1 = execCalls[1]?.argv[execCalls[1].argv.indexOf("-vf") + 1];
    expect(filter1).toBe("trim=start=1.000:end=1.800,setpts=PTS-STARTPTS");
  });

  it("passthrough: returns a single scene clip covering the whole input and runs NO ffmpeg when there are no scenes", async () => {
    const execCalls: unknown[] = [];
    const splitter = new FfmpegSceneSplitter(async (...args) => {
      execCalls.push(args);
    });
    const noScenesClip: RawClip = { ...clip, scenes: [] };

    const sceneClips = await splitter.split(noScenesClip);

    expect(execCalls).toHaveLength(0);
    expect(sceneClips).toHaveLength(1);
    expect(sceneClips[0]?.path).toBe(noScenesClip.path);
    expect(sceneClips[0]?.durationMs).toBe(noScenesClip.durationMs);
  });
});
