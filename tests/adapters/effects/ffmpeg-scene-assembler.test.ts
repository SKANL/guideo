import { describe, expect, it } from "vitest";
import { FfmpegSceneAssembler } from "../../../src/adapters/effects/ffmpeg-scene-assembler.js";
import type { SceneClip } from "../../../src/domain/ports/scene-splitter.js";

const sceneClips: SceneClip[] = [
  { narrationSegmentId: "s1", path: "scene-0.mp4", durationMs: 1000 },
  { narrationSegmentId: "s2", path: "scene-1.mp4", durationMs: 800 },
  { narrationSegmentId: "s3", path: "scene-2.mp4", durationMs: 1500 },
];

describe("FfmpegSceneAssembler", () => {
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

  describe('transitionStyle: "dip" (explicit — duration-preserving fallback)', () => {
    it("concatenates all scene clips with a single ffmpeg call and rebases contiguous 0-based scenes", async () => {
      const execCalls: { ffmpegPath: string; argv: readonly string[] }[] = [];
      const assembler = new FfmpegSceneAssembler(async (ffmpegPath, argv) => {
        execCalls.push({ ffmpegPath, argv });
      });

      const result = await assembler.assemble(sceneClips, { transitionStyle: "dip" });

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

      await assembler.assemble(sceneClips, { transitionStyle: "dip", transitionDurationSec: 0.4 });

      const filterComplex = execCalls[0]?.argv[
        execCalls[0].argv.indexOf("-filter_complex") + 1
      ] as string;
      expect(filterComplex).toContain("d=0.4");
      expect(filterComplex).not.toContain("xfade");
    });
  });

  describe('transitionStyle: "xfade" (default — real crossfade, overlap-adjusted scenes)', () => {
    it("defaults to xfade with no explicit config", async () => {
      const execCalls: { argv: readonly string[] }[] = [];
      const assembler = new FfmpegSceneAssembler(async (_ffmpegPath, argv) => {
        execCalls.push({ argv });
      });

      const result = await assembler.assemble(sceneClips);

      const filterComplex = execCalls[0]?.argv[
        execCalls[0].argv.indexOf("-filter_complex") + 1
      ] as string;
      expect(filterComplex).toContain("xfade=");

      // total = sum(1000+800+1500) - (3-1)*250 = 3300 - 500 = 2800
      expect(result.durationMs).toBe(2800);
      // scene i startMs = sum(clip[0..i-1].duration) - i*transitionDurationSec, clamped >= 0
      expect(result.scenes).toEqual([
        { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
        { narrationSegmentId: "s2", startMs: 750, endMs: 1550 },
        { narrationSegmentId: "s3", startMs: 1300, endMs: 2800 },
      ]);
    });

    it("uses the given transitionDurationSec for both the ffmpeg xfade args and the reported overlap-adjusted scenes", async () => {
      const execCalls: { argv: readonly string[] }[] = [];
      const assembler = new FfmpegSceneAssembler(async (_ffmpegPath, argv) => {
        execCalls.push({ argv });
      });

      const result = await assembler.assemble(sceneClips, {
        transitionStyle: "xfade",
        transitionDurationSec: 0.5,
      });

      const filterComplex = execCalls[0]?.argv[
        execCalls[0].argv.indexOf("-filter_complex") + 1
      ] as string;
      expect(filterComplex).toContain("duration=0.5");

      // total = 3300 - 2*500 = 2300
      expect(result.durationMs).toBe(2300);
      expect(result.scenes).toEqual([
        { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
        // s2 start = 1000 - 1*500 = 500
        { narrationSegmentId: "s2", startMs: 500, endMs: 1300 },
        // s3 start = 1800 - 2*500 = 800
        { narrationSegmentId: "s3", startMs: 800, endMs: 2300 },
      ]);
    });

    it("clamps a scene's overlap-adjusted startMs to 0 when the formula would go negative", async () => {
      const tinyClips: SceneClip[] = [
        { narrationSegmentId: "s1", path: "scene-0.mp4", durationMs: 100 },
        { narrationSegmentId: "s2", path: "scene-1.mp4", durationMs: 100 },
      ];
      const assembler = new FfmpegSceneAssembler(async () => {});

      const result = await assembler.assemble(tinyClips, {
        transitionStyle: "xfade",
        transitionDurationSec: 0.25,
      });

      // s2 start = 100 - 1*250 = -150 -> clamped to 0
      expect(result.scenes[1]?.startMs).toBe(0);
    });
  });
});
