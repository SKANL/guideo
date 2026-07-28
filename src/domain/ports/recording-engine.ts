import type { RawClip } from "../models/media.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";

// capture() requires ApprovedStoryboard, not Storyboard — this is the compile-time hard-stop
// realizing the spec's REVIEW gate: no RecordingEngine implementation is reachable before a
// human approval has minted an ApprovedStoryboard via the ReviewGate (src/domain/review-gate.ts).
//
// segmentDurationsMs (narration-driven timing): maps narrationSegmentId -> the synthesized
// narration audio's durationMs for that segment. pipeline.render() synthesizes voice BEFORE
// calling capture() so this map is always known; an implementation paces each group of steps
// sharing a narrationSegmentId ("scene") to fill roughly that duration. Optional so a segment
// with no known duration (or a caller that hasn't wired timing) doesn't crash — implementations
// fall back to their own default pacing.
export interface RecordingEngine {
  capture(
    storyboard: ApprovedStoryboard,
    segmentDurationsMs?: ReadonlyMap<string, number>,
  ): Promise<RawClip>;
}
