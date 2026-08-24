import type { MotionBeat, MotionPlan, MotionPostcondition, MotionTarget } from "../models/motion-plan.js";
import type { Script } from "../models/script.js";
import { assertNarrationRefsResolve } from "../models/script.js";
import type { Storyboard, StoryboardStep } from "../models/storyboard.js";

const SEMANTIC_ACTIONS = new Set(["click", "hover"]);
const FOCUS_MIN_DURATION_MS = 800;

function targetFor(step: StoryboardStep): MotionTarget | undefined {
  if (!SEMANTIC_ACTIONS.has(step.action) || !step.selector) return undefined;
  const evidence = step.evidence?.reference ?? step.evidence?.locatorCandidates?.[0] ?? step.selector;
  return { selector: step.selector, evidence };
}
function postconditionFor(step: StoryboardStep): MotionPostcondition | undefined {
  return step.evidence?.expectedPostState ? { evidence: step.evidence.expectedPostState } : undefined;
}
function confidenceFor(step: StoryboardStep, postcondition: MotionPostcondition | undefined): "low" | "medium" | "high" {
  if (!step.evidence?.reference) return "low";
  return postcondition ? "high" : "medium";
}
function focusRequested(step: StoryboardStep, durationMs: number, confidence: string): boolean {
  return step.params?.requiresFocus === true && durationMs >= FOCUS_MIN_DURATION_MS && confidence !== "low";
}
function deriveStepBeats(segmentId: string, stepIndex: number, startMs: number, durationMs: number, step: StoryboardStep): MotionBeat[] {
  const target = targetFor(step);
  const postcondition = postconditionFor(step);
  const confidence = confidenceFor(step, postcondition);
  const common = { narrationSegmentId: segmentId, stepIndex, target, postcondition, confidence, captionSafeRegion: "lower-third" as const };
  if (!target) return [{ ...common, kind: "establish", intent: "establish", rationale: "keep stable context", startMs, durationMs }];
  const focus = focusRequested(step, durationMs, confidence);
  const establishMs = Math.floor(durationMs * 0.2);
  const focusMs = focus ? Math.floor(durationMs * 0.2) : 0;
  const actionMs = Math.floor(durationMs * 0.28);
  const resultMs = Math.floor(durationMs * 0.32);
  const holdMs = durationMs - establishMs - focusMs - actionMs - resultMs;
  const actionStart = startMs + establishMs + focusMs;
  const resultRationale = postcondition ? `show that ${postcondition.evidence}` : "hold stable framing after the action";
  const beats: MotionBeat[] = [{ ...common, kind: "establish", intent: "establish", rationale: "establish the relevant UI context", startMs, durationMs: establishMs }];
  if (focus) beats.push({ ...common, kind: "focus", intent: "focus", rationale: `make ${target.evidence} readable before the action`, startMs: startMs + establishMs, durationMs: focusMs, zoomEligible: true });
  beats.push({ ...common, kind: "action", intent: "action", rationale: `show the ${step.action} on ${target.evidence}`, startMs: actionStart, durationMs: actionMs, zoomEligible: focus });
  beats.push({ ...common, kind: "result", intent: "result", rationale: resultRationale, startMs: actionStart + actionMs, durationMs: resultMs });
  beats.push({ ...common, kind: postcondition ? "reveal" : "hold", intent: postcondition ? "reveal" : "hold", rationale: resultRationale, startMs: actionStart + actionMs + resultMs, durationMs: holdMs });
  return beats;
}
export function deriveMotionPlan(storyboard: Storyboard, script: Script): MotionPlan {
  assertNarrationRefsResolve(storyboard, script);
  const indicesBySegment = new Map<string, number[]>();
  storyboard.steps.forEach((step, index) => indicesBySegment.set(step.narrationSegmentId, [...(indicesBySegment.get(step.narrationSegmentId) ?? []), index]));
  const beats: MotionBeat[] = [];
  for (const segment of script.segments) {
    const indices = indicesBySegment.get(segment.id) ?? [];
    for (const [position, stepIndex] of indices.entries()) {
      const step = storyboard.steps[stepIndex]; if (!step) continue;
      const startMs = segment.timing.startMs + Math.floor((position * segment.timing.durationMs) / indices.length);
      const endMs = segment.timing.startMs + Math.floor(((position + 1) * segment.timing.durationMs) / indices.length);
      beats.push(...deriveStepBeats(segment.id, stepIndex, startMs, endMs - startMs, step));
    }
  }
  return { beats };
}
