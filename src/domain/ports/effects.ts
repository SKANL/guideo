import type { RawClip } from "../models/media.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";

// EffectsEngine — the Edit stage (design doc section B). apply() maps each StoryboardStep's
// AI-proposed effects onto that step's scene time range (matched via narrationSegmentId ->
// clip.scenes[*]) and returns a new RawClip pointing at the edited video, with the same `scenes`
// metadata (the edit only changes pixels, never scene boundaries). Requires ApprovedStoryboard,
// not Storyboard — same compile-time REVIEW-gate hard stop as RecordingEngine.capture().
export interface EffectsEngine {
  apply(clip: RawClip, storyboard: ApprovedStoryboard): Promise<RawClip>;
}
