import type { FrameCheckpoint } from "../ports/frame-checkpoint-probe.js";

export interface RenderObservability {
  readonly deadAirMs: number;
  readonly captionOverlapMs: number;
  readonly zoomsWithoutTarget: number;
}

export interface VisualBaselineReport {
  readonly status: "passed" | "failed";
  readonly failures: readonly string[];
}

interface TimedRange { readonly startMs: number; readonly durationMs: number; }
interface ScriptSegment { readonly id: string; readonly timing: TimedRange; }
interface StoryboardStep {
  readonly narrationSegmentId: string;
  readonly selector?: string | undefined;
  readonly director?: { readonly focus?: { readonly target?: string | undefined } | undefined } | undefined;
  readonly effects?: readonly { readonly type: string; readonly params?: Readonly<Record<string, unknown>> }[];
}

/** Measures visual-quality risk from persisted render inputs, without decoding video twice. */
export function measureRenderObservability(input: {
  readonly segments: readonly ScriptSegment[];
  readonly storyboard: { readonly steps: readonly StoryboardStep[] };
  readonly captions: readonly TimedRange[];
}): RenderObservability {
  const orderedSegments = [...input.segments].sort((left, right) => left.timing.startMs - right.timing.startMs);
  const deadAirMs = orderedSegments.slice(1).reduce((total, segment, index) => {
    const previous = orderedSegments[index]!;
    return total + Math.max(0, segment.timing.startMs - (previous.timing.startMs + previous.timing.durationMs));
  }, 0);
  const orderedCaptions = [...input.captions].sort((left, right) => left.startMs - right.startMs);
  const captionOverlapMs = orderedCaptions.slice(1).reduce((total, caption, index) => {
    const previous = orderedCaptions[index]!;
    return total + Math.max(0, Math.min(previous.startMs + previous.durationMs, caption.startMs + caption.durationMs) - caption.startMs);
  }, 0);
  const zoomsWithoutTarget = input.storyboard.steps.reduce((total, step) => total + (step.effects ?? []).filter((effect) =>
    (effect.type === "zoom-in" || effect.type === "zoom-out") && !hasTarget(step, effect.params),
  ).length, 0);
  return { deadAirMs, captionOverlapMs, zoomsWithoutTarget };
}

/** Compares exactly the deterministic FFmpeg checkpoint hashes selected by validate. */
export function compareVisualBaseline(
  current: readonly FrameCheckpoint[],
  baseline: readonly FrameCheckpoint[],
): VisualBaselineReport {
  const baselineByTime = new Map(baseline.map((checkpoint) => [checkpoint.atMs, checkpoint]));
  const failures: string[] = [];
  for (const checkpoint of current) {
    const expected = baselineByTime.get(checkpoint.atMs);
    if (!expected) failures.push(`visual baseline is missing frame checkpoint ${checkpoint.atMs}ms`);
    else if (expected.sha256 !== checkpoint.sha256) failures.push(`frame checkpoint ${checkpoint.atMs}ms differs from visual baseline`);
  }
  for (const checkpoint of baseline) {
    if (!current.some(({ atMs }) => atMs === checkpoint.atMs)) failures.push(`render is missing frame checkpoint ${checkpoint.atMs}ms required by visual baseline`);
  }
  return { status: failures.length === 0 ? "passed" : "failed", failures };
}

function hasTarget(step: StoryboardStep, params: Readonly<Record<string, unknown>> | undefined): boolean {
  return Boolean(step.selector || step.director?.focus?.target || (typeof params?.selector === "string" && params.selector.length > 0));
}
