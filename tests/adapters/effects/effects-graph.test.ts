import { describe, expect, it, vi } from "vitest";
import { buildSceneEffectsGraph } from "../../../src/adapters/effects/effects-graph.js";
import type { RawClip } from "../../../src/domain/models/media.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { SceneClip } from "../../../src/domain/ports/scene-splitter.js";
import { review } from "../../../src/domain/review-gate.js";

function approve(steps: Parameters<typeof parseStoryboard>[0]) {
  const storyboard = parseStoryboard(steps);
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

describe("buildSceneEffectsGraph — per-scene-clip architecture: maps ONE scene's effects onto its OWN clip's whole timeline", () => {
  it("returns null when the target scene has no effects (passthrough signal)", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
    };
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-1",
      path: "scene-0.mp4",
      durationMs: 1000,
    };
    const approved = approve({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });

    expect(buildSceneEffectsGraph(clip, sceneClip, approved)).toBeNull();
  });

  it("builds one filter_complex chain gated to the SCENE CLIP's own [0, durationMs] timeline, not the original clip's scene range", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 3000,
      aspectRatio: "16:9",
      scenes: [
        { narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 },
        { narrationSegmentId: "seg-2", startMs: 1000, endMs: 3000 },
      ],
      preRollMs: 0,
    };
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
    // seg-2's own scene clip is exactly 2s, starting at LOCAL time 0 (not 1s as it was on the
    // shared/original clip's timeline).
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-2",
      path: "scene-1.mp4",
      durationMs: 2000,
    };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    expect(graph).not.toBeNull();
    expect(graph?.filterComplex).toContain("enable='between(t,0,2)'");
    expect(graph?.filterComplex).toContain("[0:v]split=2");
    expect(graph?.outputLabel).toBe("[v1]");
  });

  it("uses optional motion entry and exit timing while preserving the full-scene default", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 2000,
      aspectRatio: "16:9",
      scenes: [],
      preRollMs: 0,
    };
    const sceneClip: SceneClip = {
      path: "scene.mp4",
      narrationSegmentId: "seg-1",
      durationMs: 2000,
    };
    const approved = approve({
      steps: [
        {
          action: "click",
          selector: "#invite",
          narrationSegmentId: "seg-1",
          effects: [
            {
              type: "zoom-in",
              params: { level: 1.12, entryMs: 300, exitMs: 1200 },
            },
          ],
        },
      ],
    });

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    expect(graph?.filterComplex).toContain("enable='between(t,0.3,1.2)'");
  });

  it("keeps the capture-resolved focal region and raises a weak requested zoom to the professional minimum", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 2000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 2000 }],
      preRollMs: 0,
      resolvedEffects: [
        { narrationSegmentId: "seg-1", type: "zoom-in", region: { x: 1400, y: 700, w: 80, h: 40 } },
      ],
    };
    const approved = approve({
      steps: [{
        action: "click",
        selector: "#add-to-cart",
        narrationSegmentId: "seg-1",
        effects: [{ type: "zoom-in", params: { level: 1.12 } }],
      }],
    });
    const sceneClip: SceneClip = { narrationSegmentId: "seg-1", path: "scene.mp4", durationMs: 2000 };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    // center = 1440, 720. The graph must consume capture evidence, rather than fall back to frame center.
    expect(graph?.filterComplex).toContain("x='1440-");
    expect(graph?.filterComplex).toContain("y='720-");
    // 1.12 is visually too subtle at 1080p; the renderer enforces the documented professional floor.
    expect(graph?.filterComplex).toContain("(1+(1.25-1)*");
  });

  it("only applies effects belonging to the target scene, ignoring other scenes' effects entirely (no warning)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 2000,
      aspectRatio: "16:9",
      scenes: [
        { narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 },
        { narrationSegmentId: "seg-2", startMs: 1000, endMs: 2000 },
      ],
      preRollMs: 0,
    };
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [{ type: "zoom-in", params: {} }],
        },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-2",
      path: "scene-1.mp4",
      durationMs: 1000,
    };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    expect(graph).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("chains multiple effects belonging to the same scene, threading each output label into the next input", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 2000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 2000 }],
      preRollMs: 0,
    };
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [
            { type: "zoom-in", params: {} },
            { type: "blur-region", params: { x: 1, y: 2, w: 3, h: 4 } },
          ],
        },
      ],
    });
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-1",
      path: "scene-0.mp4",
      durationMs: 2000,
    };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    expect(graph?.filterComplex).toContain("[0:v]split=2[e1_base][e1_src]");
    expect(graph?.filterComplex).toContain("[v1]split=2[e2_base][e2_src]");
    expect(graph?.outputLabel).toBe("[v2]");
  });

  // --- Resolved regions: content-reframing is UNCHANGED by this relocation ------------------
  // resolvedEffects stays POSITIONAL across the WHOLE original clip's storyboard.steps order (the
  // same order WebRecordingEngine.capture() resolved them in) — buildSceneEffectsGraph must walk
  // every step (advancing the position counter for skipped scenes too) to stay aligned, even
  // though it only emits fragments for the target scene.

  it("uses clip.resolvedEffects's region (captured selector target) even when earlier scenes' effects are skipped", () => {
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
        { narrationSegmentId: "seg-1", type: "zoom-in", region: { x: 5, y: 5, w: 10, h: 10 } },
        { narrationSegmentId: "seg-2", type: "zoom-in", region: { x: 100, y: 40, w: 20, h: 20 } },
      ],
    };
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [{ type: "zoom-in", params: {} }],
        },
        {
          action: "pause",
          narrationSegmentId: "seg-2",
          effects: [{ type: "zoom-in", params: {} }],
        },
      ],
    });
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-2",
      path: "scene-1.mp4",
      durationMs: 1000,
    };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    // center = x + w/2 = 110, y + h/2 = 50 — seg-2's resolved region, NOT seg-1's (index 0) or the
    // frame center.
    expect(graph?.filterComplex).toContain("x='110-");
    expect(graph?.filterComplex).toContain("y='50-");
  });

  it("falls back to reading an explicit region straight from effect.params when clip.resolvedEffects is absent (back-compat)", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
    };
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [{ type: "crop", params: { x: 10, y: 20, w: 100, h: 50 } }],
        },
      ],
    });
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-1",
      path: "scene-0.mp4",
      durationMs: 1000,
    };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    expect(graph?.filterComplex).toContain("drawbox=x=10:y=20:w=100:h=50:color=white@0.9:t=4");
    expect(graph?.filterComplex).not.toContain("color=black");
    expect(graph?.filterComplex).not.toContain("t=fill");
  });

  it("falls back to the frame center for zoom-in when neither resolvedEffects nor explicit params supply a region", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
      resolvedEffects: [{ narrationSegmentId: "seg-1", type: "zoom-in", region: null }],
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
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-1",
      path: "scene-0.mp4",
      durationMs: 1000,
    };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    expect(graph?.filterComplex).toContain("x='iw/2-");
  });

  it("skips a malformed effect (fails its own builder validation) instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
    };
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [{ type: "crop", params: { x: 1 } }],
        },
      ],
    });
    const sceneClip: SceneClip = {
      narrationSegmentId: "seg-1",
      path: "scene-0.mp4",
      durationMs: 1000,
    };

    const graph = buildSceneEffectsGraph(clip, sceneClip, approved);

    expect(graph).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
