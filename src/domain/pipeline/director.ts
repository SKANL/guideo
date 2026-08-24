import type { Effect } from "../models/effect.js";
import type { Script } from "../models/script.js";
import type { Storyboard, StoryboardStep } from "../models/storyboard.js";
import { deriveMotionPlan } from "./motion-planner.js";

export interface DirectorConfig {
  readonly motionEmphasisEnabled: boolean;
  // Legacy opt-in retained for callers that used the former switch. It now enables deterministic,
  // semantic emphasis rather than the removed scene-interval selection.
  readonly zoomDefaultsEnabled: boolean;
  readonly zoomLevel: number;
}

export const DEFAULT_CONTENT_REGION = { x: 330, y: 96, w: 830, h: 540 } as const;

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  motionEmphasisEnabled: false,
  zoomDefaultsEnabled: false,
  zoomLevel: 1.12,
};

interface Scene {
  readonly narrationSegmentId: string;
  readonly indices: readonly number[];
}

function groupIntoScenes(steps: readonly StoryboardStep[]): Scene[] {
  const scenes: { narrationSegmentId: string; indices: number[] }[] = [];
  steps.forEach((step, index) => {
    const last = scenes[scenes.length - 1];
    if (last && last.narrationSegmentId === step.narrationSegmentId) last.indices.push(index);
    else scenes.push({ narrationSegmentId: step.narrationSegmentId, indices: [index] });
  });
  return scenes;
}

function hasAnyEffect(steps: readonly StoryboardStep[], scene: Scene): boolean {
  return scene.indices.some((index) => (steps[index]?.effects.length ?? 0) > 0);
}

function withAddedEffect(step: StoryboardStep, effect: Effect): StoryboardStep {
  return { ...step, effects: [...step.effects, effect] };
}

export function applyDirectorDefaults(
  storyboard: Storyboard,
  script: Script,
  config: Partial<DirectorConfig> = {},
): Storyboard {
  const cfg = { ...DEFAULT_DIRECTOR_CONFIG, ...config };
  if (!cfg.motionEmphasisEnabled && !cfg.zoomDefaultsEnabled) return storyboard;

  const steps = [...storyboard.steps];
  const plan = deriveMotionPlan(storyboard, script);
  const scenes = groupIntoScenes(steps);
  for (const scene of scenes) {
    if (hasAnyEffect(steps, scene)) continue;
    const actionBeat = plan.beats.find(
      (beat) =>
        beat.narrationSegmentId === scene.narrationSegmentId &&
        scene.indices.includes(beat.stepIndex) &&
        beat.kind === "action" &&
        beat.target,
    );
    if (!actionBeat?.target) continue;
    const setupBeat = plan.beats.find(
      (beat) => beat.stepIndex === actionBeat.stepIndex && beat.kind === "setup",
    );
    const holdBeat = plan.beats.find(
      (beat) => beat.stepIndex === actionBeat.stepIndex && beat.kind === "hold",
    );
    const step = steps[actionBeat.stepIndex];
    if (!step || !setupBeat || !holdBeat) continue;
    const segmentStartMs = script.segments.find(
      (segment) => segment.id === actionBeat.narrationSegmentId,
    )?.timing.startMs;
    if (segmentStartMs === undefined) continue;

    steps[actionBeat.stepIndex] = withAddedEffect(step, {
      type: "zoom-in",
      params: {
        selector: actionBeat.target.selector,
        semanticTarget: actionBeat.target.evidence,
        level: cfg.zoomLevel,
        entryMs: setupBeat.startMs - segmentStartMs,
        exitMs: holdBeat.startMs + holdBeat.durationMs - segmentStartMs,
      },
    });
  }

  return { ...storyboard, steps };
}
