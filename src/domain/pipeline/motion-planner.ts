import type { MotionBeat, MotionPlan, MotionTarget } from "../models/motion-plan.js";
import type { Script } from "../models/script.js";
import { assertNarrationRefsResolve } from "../models/script.js";
import type { Storyboard, StoryboardStep } from "../models/storyboard.js";

const BEAT_WEIGHTS = { setup: 15, action: 45, reaction: 25 } as const;
const SEMANTIC_ACTIONS = new Set(["click", "hover"]);

function semanticTarget(step: StoryboardStep): MotionTarget | undefined {
  if (!SEMANTIC_ACTIONS.has(step.action) || !step.selector) return undefined;
  const evidence =
    step.evidence?.reference ?? step.evidence?.locatorCandidates?.[0] ?? step.selector;
  return evidence ? { selector: step.selector, evidence } : undefined;
}

function deriveStepBeats(
  narrationSegmentId: string,
  stepIndex: number,
  startMs: number,
  durationMs: number,
  target: MotionTarget | undefined,
): MotionBeat[] {
  const setupMs = Math.floor((durationMs * BEAT_WEIGHTS.setup) / 100);
  const actionMs = Math.floor((durationMs * BEAT_WEIGHTS.action) / 100);
  const reactionMs = Math.floor((durationMs * BEAT_WEIGHTS.reaction) / 100);
  const holdMs = durationMs - setupMs - actionMs - reactionMs;
  const beat = (
    kind: MotionBeat["kind"],
    offsetMs: number,
    beatDurationMs: number,
  ): MotionBeat => ({
    kind,
    narrationSegmentId,
    stepIndex,
    startMs: startMs + offsetMs,
    durationMs: beatDurationMs,
    ...(target ? { target } : {}),
  });

  return [
    beat("setup", 0, setupMs),
    beat("action", setupMs, actionMs),
    beat("reaction", setupMs + actionMs, reactionMs),
    beat("hold", setupMs + actionMs + reactionMs, holdMs),
  ];
}

export function deriveMotionPlan(storyboard: Storyboard, script: Script): MotionPlan {
  assertNarrationRefsResolve(storyboard, script);
  const stepIndicesBySegment = new Map<string, number[]>();
  storyboard.steps.forEach((step, stepIndex) => {
    const indices = stepIndicesBySegment.get(step.narrationSegmentId) ?? [];
    indices.push(stepIndex);
    stepIndicesBySegment.set(step.narrationSegmentId, indices);
  });

  const beats: MotionBeat[] = [];
  for (const segment of script.segments) {
    const indices = stepIndicesBySegment.get(segment.id) ?? [];
    for (const [position, stepIndex] of indices.entries()) {
      const step = storyboard.steps[stepIndex];
      if (!step) continue;
      const stepStart =
        segment.timing.startMs +
        Math.floor((position * segment.timing.durationMs) / indices.length);
      const stepEnd =
        segment.timing.startMs +
        Math.floor(((position + 1) * segment.timing.durationMs) / indices.length);
      beats.push(
        ...deriveStepBeats(
          segment.id,
          stepIndex,
          stepStart,
          stepEnd - stepStart,
          semanticTarget(step),
        ),
      );
    }
  }

  return { beats };
}
