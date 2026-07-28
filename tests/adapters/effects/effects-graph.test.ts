import { describe, expect, it, vi } from "vitest";
import { buildEffectsGraph } from "../../../src/adapters/effects/effects-graph.js";
import type { RawClip } from "../../../src/domain/models/media.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { review } from "../../../src/domain/review-gate.js";

function approve(steps: Parameters<typeof parseStoryboard>[0]) {
  const storyboard = parseStoryboard(steps);
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

describe("buildEffectsGraph — maps AI-proposed per-step effects onto their scene time range", () => {
  it("returns null when no step has any effects (fast passthrough signal)", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
    };
    const approved = approve({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });

    expect(buildEffectsGraph(clip, approved)).toBeNull();
  });

  it("builds one filter_complex chain gated to the matching scene's [startMs,endMs] in seconds", () => {
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

    const graph = buildEffectsGraph(clip, approved);

    expect(graph).not.toBeNull();
    expect(graph?.filterComplex).toContain("enable='between(t,1,3)'");
    expect(graph?.filterComplex).toContain("[0:v]split=2");
    expect(graph?.outputLabel).toBe("[v1]");
  });

  it("chains multiple effects across multiple steps, threading each output label into the next input", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 4000,
      aspectRatio: "16:9",
      scenes: [
        { narrationSegmentId: "seg-1", startMs: 0, endMs: 2000 },
        { narrationSegmentId: "seg-2", startMs: 2000, endMs: 4000 },
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
        {
          action: "pause",
          narrationSegmentId: "seg-2",
          effects: [{ type: "blur-region", params: { x: 1, y: 2, w: 3, h: 4 } }],
        },
      ],
    });

    const graph = buildEffectsGraph(clip, approved);

    expect(graph?.filterComplex).toContain("[0:v]split=2[e1_base][e1_src]");
    // second effect's fragment must consume the FIRST effect's output label as its input.
    expect(graph?.filterComplex).toContain("[v1]split=2[e2_base][e2_src]");
    expect(graph?.outputLabel).toBe("[v2]");
  });

  it("skips (logs + continues) a step whose narrationSegmentId has no matching scene on the clip", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [],
      preRollMs: 0,
    };
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "no-such-scene",
          effects: [{ type: "zoom-in", params: {} }],
        },
      ],
    });

    const graph = buildEffectsGraph(clip, approved);

    expect(graph).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // --- Resolved regions (effects-overhaul Phase A: targeting) ------------------------------
  // buildEffectsGraph must COMBINE the resolved region (from clip.resolvedEffects, captured while
  // the target element was on screen) with the TIME gate (from clip.scenes) — this is the fix for
  // effects always zooming the center regardless of the AI-proposed selector.

  it("uses clip.resolvedEffects's region (captured selector target), centering zoom-in there instead of the frame", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
      resolvedEffects: [
        { narrationSegmentId: "seg-1", type: "zoom-in", region: { x: 100, y: 40, w: 20, h: 20 } },
      ],
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

    const graph = buildEffectsGraph(clip, approved);

    // center = x + w/2 = 110, y + h/2 = 50 — NOT the frame center (iw/2, ih/2).
    expect(graph?.filterComplex).toContain("x='110-");
    expect(graph?.filterComplex).toContain("y='50-");
    expect(graph?.filterComplex).not.toContain("iw/2");
  });

  it("falls back to reading an explicit region straight from effect.params when clip.resolvedEffects is absent (back-compat)", () => {
    const clip: RawClip = {
      path: "clip.mp4",
      durationMs: 1000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      preRollMs: 0,
      // no resolvedEffects field at all
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

    const graph = buildEffectsGraph(clip, approved);

    expect(graph?.filterComplex).toContain("drawbox=x=0:y=0:w=iw:h=20");
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

    const graph = buildEffectsGraph(clip, approved);

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

    const graph = buildEffectsGraph(clip, approved);

    expect(graph).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
