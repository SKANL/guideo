import type { RawClip } from "../models/media.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";

// capture() requires ApprovedStoryboard, not Storyboard — this is the compile-time hard-stop
// realizing the spec's REVIEW gate: no RecordingEngine implementation is reachable before a
// human approval has minted an ApprovedStoryboard via the ReviewGate (src/domain/review-gate.ts).
export interface RecordingEngine {
  capture(storyboard: ApprovedStoryboard): Promise<RawClip>;
}
