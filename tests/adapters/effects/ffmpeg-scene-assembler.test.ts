import { describe, expect, it } from "vitest";
import { FfmpegSceneAssembler } from "../../../src/adapters/effects/ffmpeg-scene-assembler.js";
import type { SceneClip } from "../../../src/domain/ports/scene-splitter.js";

const sceneClips: SceneClip[] = [
  { narrationSegmentId: "s1", path: "scene-0.mp4", durationMs: 1000 },
  { narrationSegmentId: "s2", path: "scene-1.mp4", durationMs: 800 },
  { narrationSegmentId: "s3", path: "scene-2.mp4", durationMs: 1500 },
];

describe("FfmpegSceneAssembler", () => {
  it("concatenates all scene clips with a single ffmpeg call and rebases contiguous 0-based scenes", async () => {
    const execCalls: { ffmpegPath: string; argv: readonly string[] }[] = [];
    const assembler = new FfmpegSceneAssembler(async (ffmpegPath, argv) => {
      execCalls.push({ ffmpegPath, argv });
    });

    const result = await assembler.assemble(sceneClips);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]?.argv).toContain("scene-0.mp4");
    expect(execCalls[0]?.argv).toContain("scene-1.mp4");
    expect(execCalls[0]?.argv).toContain("scene-2.mp4");

    expect(result.durationMs).toBe(3300);
    expect(result.preRollMs).toBe(0);
    expect(result.aspectRatio).toBe("16:9");
    expect(result.scenes).toEqual([
      { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
      { narrationSegmentId: "s2", startMs: 1000, endMs: 1800 },
      { narrationSegmentId: "s3", startMs: 1800, endMs: 3300 },
    ]);
  });

  it("uses the given transitionDurationSec when building the fade args", async () => {
    const execCalls: { argv: readonly string[] }[] = [];
    const assembler = new FfmpegSceneAssembler(async (_ffmpegPath, argv) => {
      execCalls.push({ argv });
    });

    await assembler.assemble(sceneClips, { transitionDurationSec: 0.4 });

    const filterComplex = execCalls[0]?.argv[
      execCalls[0].argv.indexOf("-filter_complex") + 1
    ] as string;
    expect(filterComplex).toContain("d=0.4");
  });

  it("passthrough: a single scene clip runs NO ffmpeg and becomes the whole assembled RawClip unchanged", async () => {
    const execCalls: unknown[] = [];
    const assembler = new FfmpegSceneAssembler(async (...args) => {
      execCalls.push(args);
    });
    const only: SceneClip[] = [{ narrationSegmentId: "s1", path: "scene-0.mp4", durationMs: 1000 }];

    const result = await assembler.assemble(only);

    expect(execCalls).toHaveLength(0);
    expect(result.path).toBe("scene-0.mp4");
    expect(result.durationMs).toBe(1000);
    expect(result.scenes).toEqual([{ narrationSegmentId: "s1", startMs: 0, endMs: 1000 }]);
  });
});
