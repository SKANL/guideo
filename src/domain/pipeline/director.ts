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
  // 25% is visible at the 1080p delivery profile while remaining restrained for product UI.
  zoomLevel: 1.25,
};

function withAddedEffect(step: StoryboardStep, effect: Effect): StoryboardStep {
  return { ...step, effects: [...step.effects, effect] };
}

export function applyDirectorDefaults(
  storyboard: Storyboard,
  script: Script,
  config: Partial<DirectorConfig> = {},
): Storyboard {
  const cfg = { ...DEFAULT_DIRECTOR_CONFIG, ...config };
  // The legacy option is retained in the config contract, but it must not turn selector evidence
  // back into a zoom. Only the semantic-emphasis mode can compile an explicit focus cue.
  if (!cfg.motionEmphasisEnabled) return storyboard;

  const steps = [...storyboard.steps];
  const plan = deriveMotionPlan(storyboard, script);
  const zoomedSteps = new Set<number>();
  for (const actionBeat of plan.beats) {
    if (actionBeat.kind !== "action" || actionBeat.intent !== "action" || !actionBeat.target)
      continue;
    const step = steps[actionBeat.stepIndex];
    if (!step || step.effects.length > 0) continue;
    const reactionBeat = plan.beats.find(
      (beat) => beat.stepIndex === actionBeat.stepIndex && beat.kind === "result",
    );
    if (!step || !reactionBeat) continue;
    const segmentStartMs = script.segments.find(
      (segment) => segment.id === actionBeat.narrationSegmentId,
    )?.timing.startMs;
    if (segmentStartMs === undefined) continue;

    const timing = {
      entryMs: actionBeat.startMs - segmentStartMs,
      exitMs: reactionBeat.startMs + reactionBeat.durationMs - segmentStartMs,
    };
    let nextStep = step;
    if (cfg.motionEmphasisEnabled) {
      nextStep = withAddedEffect(nextStep, {
        type: "crop",
        params: {
          selector: actionBeat.target.selector,
          semanticTarget: actionBeat.target.evidence,
          emphasis: "spotlight",
          ...timing,
        },
      });
    }
    // A zoom is never a clock tick; deriveMotionPlan only sets zoomEligible for requiresFocus.
    if (actionBeat.zoomEligible && !zoomedSteps.has(actionBeat.stepIndex)) {
      nextStep = withAddedEffect(nextStep, {
        type: "zoom-in",
        params: {
          selector: actionBeat.target.selector,
          semanticTarget: actionBeat.target.evidence,
          postcondition: actionBeat.postcondition?.evidence,
          level: cfg.zoomLevel,
          ...timing,
        },
      });
      zoomedSteps.add(actionBeat.stepIndex);
    }
    steps[actionBeat.stepIndex] = nextStep;
  }

  return { ...storyboard, steps };
}
