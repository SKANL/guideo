import type { RawClip } from "../models/media.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";
import type { SceneClip } from "./scene-splitter.js";

// EffectsEngine — the Edit stage (design doc section B), relocated to run PER SCENE CLIP
// (per-scene-clip architecture, completing Phase 1): applyToScenes() runs AFTER the scene split, so
// each scene clip is a self-contained unit that gets its own effects gated within its OWN timeline
// ([0, sceneClip.durationMs]) rather than a shared/whole-clip timeline. `clip` is still the
// (pre-split) RawClip the scenes were extracted from — needed for its `resolvedEffects` (the
// capture-time resolved spatial target, unchanged by this relocation) and the storyboard's effect
// params. Returns a NEW array of SceneClips (same order/narrationSegmentId/durationMs), each either
// pointing at an edited file or passed through unchanged (no ffmpeg call) when its scene has no
// effects. Requires ApprovedStoryboard, not Storyboard — same compile-time REVIEW-gate hard stop as
// RecordingEngine.capture().
export interface EffectsEngine {
  applyToScenes(
    clip: RawClip,
    sceneClips: readonly SceneClip[],
    storyboard: ApprovedStoryboard,
  ): Promise<SceneClip[]>;
}
