import { describe, expect, it } from "vitest";
import { FfmpegEffectsEngine } from "../../../src/adapters/effects/ffmpeg-effects.js";
import type { RawClip } from "../../../src/domain/models/media.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { SceneClip } from "../../../src/domain/ports/scene-splitter.js";
import { review } from "../../../src/domain/review-gate.js";

function approve(input: unknown) {
  const storyboard = parseStoryboard(input);
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

const clip: RawClip = {
  path: "clip.mp4",
  durationMs: 2000,
  aspectRatio: "16:9",
  scenes: [
    { narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 },
    { narrationSegmentId: "seg-2", startMs: 1000, endMs: 2000 },
  ],
  preRollMs: 0,
  resolvedEffects: [
    { narrationSegmentId: "seg-2", type: "zoom-in", region: { x: 100, y: 60, w: 40, h: 30 } },
  ],
};

describe("FfmpegEffectsEngine.applyToScenes — per-scene-clip architecture", () => {
  it("passthrough: a scene clip whose scene has no effects runs NO ffmpeg and is returned unchanged", async () => {
    const execCalls: unknown[] = [];
    const engine = new FfmpegEffectsEngine(async (...args) => {
      execCalls.push(args);
    });
    const sceneClips: SceneClip[] = [
      { narrationSegmentId: "seg-1", path: "scene-0.mp4", durationMs: 1000 },
    ];
    const approved = approve({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });

    const result = await engine.applyToScenes(clip, sceneClips, approved);

    expect(result).toEqual(sceneClips);
    expect(execCalls).toHaveLength(0);
  });

  it("runs ffmpeg with an argv array (never a shell string) for a scene clip whose scene HAS an effect, gated to its OWN duration", async () => {
    const execCalls: { ffmpegPath: string; argv: readonly string[] }[] = [];
    const engine = new FfmpegEffectsEngine(async (ffmpegPath, argv) => {
      execCalls.push({ ffmpegPath, argv });
    });
    const sceneClips: SceneClip[] = [
      { narrationSegmentId: "seg-2", path: "scene-1.mp4", durationMs: 1000 },
    ];
    const approved = approve({
      steps: [
        { action: "pause", narrationSegmentId: "seg-1" },
        {
          action: "pause",
          narrationSegmentId: "seg-2",
          effects: [{ type: "zoom-in", params: {} }],
        },
      ],
    });

    const result = await engine.applyToScenes(clip, sceneClips, approved);

    expect(execCalls).toHaveLength(1);
    expect(Array.isArray(execCalls[0]?.argv)).toBe(true);
    expect(execCalls[0]?.argv).toContain("scene-1.mp4");
    expect(execCalls[0]?.argv).toContain("-filter_complex");
    expect(execCalls[0]?.argv.join(" ")).toContain("enable='between(t,0,1)'");
    expect(result[0]?.path).not.toBe("scene-1.mp4");
    expect(result[0]?.narrationSegmentId).toBe("seg-2");
    expect(result[0]?.durationMs).toBe(1000);
  });

  it("applies effects independently per scene clip: only the scenes WITH effects trigger ffmpeg", async () => {
    const execCalls: unknown[] = [];
    const engine = new FfmpegEffectsEngine(async (...args) => {
      execCalls.push(args);
    });
    const sceneClips: SceneClip[] = [
      { narrationSegmentId: "seg-1", path: "scene-0.mp4", durationMs: 1000 },
      { narrationSegmentId: "seg-2", path: "scene-1.mp4", durationMs: 1000 },
    ];
    const approved = approve({
      steps: [
        { action: "pause", narrationSegmentId: "seg-1" },
        {
          action: "pause",
          narrationSegmentId: "seg-2",
          effects: [{ type: "zoom-in", params: {} }],
        },
      ],
    });

    const result = await engine.applyToScenes(clip, sceneClips, approved);

    expect(execCalls).toHaveLength(1);
    expect(result[0]).toEqual(sceneClips[0]);
    expect(result[1]?.path).not.toBe("scene-1.mp4");
  });
});
