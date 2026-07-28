import { describe, expect, it, vi } from "vitest";
import { buildEffectsGraph } from "../../../src/adapters/effects/effects-graph.js";
import type { Audio, SceneRange } from "../../../src/domain/models/media.js";
import type { Script } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import {
  derivePrivateSegmentIds,
  planPrivacyCut,
  planSceneCut,
} from "../../../src/domain/pipeline/privacy-cut.js";
import { review } from "../../../src/domain/review-gate.js";

function approve(input: unknown) {
  const storyboard = parseStoryboard(input);
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

describe("derivePrivateSegmentIds", () => {
  it("returns an empty set when no step is private", () => {
    const approved = approve({
      steps: [
        { action: "pause", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    expect(derivePrivateSegmentIds(approved.steps)).toEqual(new Set());
  });

  it("classifies a scene private when ANY of its steps is marked private", () => {
    const approved = approve({
      steps: [
        { action: "click", selector: "#a", narrationSegmentId: "seg-1", visibility: "show" },
        { action: "type", selector: "#a", narrationSegmentId: "seg-1", visibility: "private" },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    expect(derivePrivateSegmentIds(approved.steps)).toEqual(new Set(["seg-1"]));
  });
});

describe("planSceneCut — pure video-range cut/rebase logic", () => {
  const scenes: SceneRange[] = [
    { narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 },
    { narrationSegmentId: "seg-2", startMs: 1000, endMs: 2500 },
    { narrationSegmentId: "seg-3", startMs: 2500, endMs: 4000 },
  ];

  it("passthrough (isNoop=true) when no scene is private: kept mirrors input 1:1", () => {
    const plan = planSceneCut(scenes, new Set());

    expect(plan.isNoop).toBe(true);
    expect(plan.kept).toEqual([
      { narrationSegmentId: "seg-1", sourceStartMs: 0, sourceEndMs: 1000, startMs: 0, endMs: 1000 },
      {
        narrationSegmentId: "seg-2",
        sourceStartMs: 1000,
        sourceEndMs: 2500,
        startMs: 1000,
        endMs: 2500,
      },
      {
        narrationSegmentId: "seg-3",
        sourceStartMs: 2500,
        sourceEndMs: 4000,
        startMs: 2500,
        endMs: 4000,
      },
    ]);
  });

  it("cuts a private scene in the MIDDLE and rebases the remainder contiguous from 0", () => {
    const plan = planSceneCut(scenes, new Set(["seg-2"]));

    expect(plan.isNoop).toBe(false);
    expect(plan.kept).toEqual([
      { narrationSegmentId: "seg-1", sourceStartMs: 0, sourceEndMs: 1000, startMs: 0, endMs: 1000 },
      {
        narrationSegmentId: "seg-3",
        sourceStartMs: 2500,
        sourceEndMs: 4000,
        startMs: 1000,
        endMs: 2500,
      },
    ]);
  });

  it("cuts a private FIRST scene and rebases the remainder to start at 0", () => {
    const plan = planSceneCut(scenes, new Set(["seg-1"]));

    expect(plan.kept).toEqual([
      {
        narrationSegmentId: "seg-2",
        sourceStartMs: 1000,
        sourceEndMs: 2500,
        startMs: 0,
        endMs: 1500,
      },
      {
        narrationSegmentId: "seg-3",
        sourceStartMs: 2500,
        sourceEndMs: 4000,
        startMs: 1500,
        endMs: 3000,
      },
    ]);
  });
});

describe("planPrivacyCut — combines scene cut + kept/rebased script + kept audio tracks", () => {
  const scenes: SceneRange[] = [
    { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
    { narrationSegmentId: "s2", startMs: 1000, endMs: 1800 },
    { narrationSegmentId: "s3", startMs: 1800, endMs: 3300 },
  ];
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

  it("is a no-op passthrough (same script/audioTracks references) when no scene is private", () => {
    const approved = approve({
      steps: [
        { action: "pause", narrationSegmentId: "s1" },
        { action: "pause", narrationSegmentId: "s2" },
        { action: "pause", narrationSegmentId: "s3" },
      ],
    });

    const plan = planPrivacyCut(scenes, approved, script, audioTracks);

    expect(plan.isNoop).toBe(true);
    expect(plan.script).toBe(script);
    expect(plan.audioTracks).toBe(audioTracks);
  });

  it("drops the private scene's audio track and rebases the kept script's timing.startMs contiguous from 0", () => {
    const approved = approve({
      steps: [
        { action: "pause", narrationSegmentId: "s1" },
        { action: "pause", narrationSegmentId: "s2", visibility: "private" },
        { action: "pause", narrationSegmentId: "s3" },
      ],
    });

    const plan = planPrivacyCut(scenes, approved, script, audioTracks);

    expect(plan.isNoop).toBe(false);
    expect(plan.audioTracks).toEqual([
      { segmentId: "s1", path: "s1.mp3", durationMs: 1000 },
      { segmentId: "s3", path: "s3.mp3", durationMs: 1500 },
    ]);
    expect(plan.script.segments).toEqual([
      { id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } },
      { id: "s3", text: "Three.", timing: { startMs: 1000, durationMs: 1500 } },
    ]);
    expect(plan.kept.map((k) => k.narrationSegmentId)).toEqual(["s1", "s3"]);
  });
});

describe("effects are re-gated to the rebased post-cut timeline (via buildEffectsGraph fed the cut clip.scenes)", () => {
  it("excludes the private scene's effect and gates the kept scene's effect to its REBASED [startMs,endMs]", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scenes: SceneRange[] = [
      { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
      { narrationSegmentId: "s2", startMs: 1000, endMs: 2000 },
    ];
    const approved = approve({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "s1",
          visibility: "private",
          effects: [{ type: "zoom-in", params: {} }],
        },
        {
          action: "pause",
          narrationSegmentId: "s2",
          effects: [{ type: "zoom-in", params: {} }],
        },
      ],
    });

    const plan = planSceneCut(scenes, derivePrivateSegmentIds(approved.steps));
    const cutClipScenes: SceneRange[] = plan.kept.map((k) => ({
      narrationSegmentId: k.narrationSegmentId,
      startMs: k.startMs,
      endMs: k.endMs,
    }));

    const graph = buildEffectsGraph(
      {
        path: "cut.mp4",
        durationMs: 1000,
        aspectRatio: "16:9",
        scenes: cutClipScenes,
        preRollMs: 0,
      },
      approved,
    );

    // s2's scene was rebased from [1000,2000] to [0,1000]; s1's effect must be absent entirely.
    expect(graph?.filterComplex).toContain("enable='between(t,0,1)'");
    expect(graph?.filterComplex).not.toContain("between(t,1,2)");
    expect(warn).toHaveBeenCalled(); // s1's effect was skipped: no matching scene on the cut clip.
    warn.mockRestore();
  });
});
