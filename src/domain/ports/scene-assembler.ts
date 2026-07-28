import type { RawClip } from "../models/media.js";
import type { SceneClip } from "./scene-splitter.js";

export interface SceneAssemblerConfig {
  readonly transitionDurationSec: number;
}

// SceneAssembler — per-scene-clip architecture Phase 1. assemble() composes the per-scene clips
// SceneSplitter produced back into ONE RawClip, applying a duration-preserving dip transition
// (LOCAL fade-in/fade-out on each clip's own edge, never a shared-timeline fade) at every scene
// boundary, then concatenating with no overlap so total duration is exactly the sum of the inputs
// — audio/subtitles derived from Script/Audio timing stay aligned. The returned RawClip's `scenes`
// are recomputed contiguous 0-based ranges over the assembled clip, same order/narrationSegmentIds
// as the input sceneClips. A single sceneClip is a safe passthrough: no transition, no re-encode.
export interface SceneAssembler {
  assemble(
    sceneClips: readonly SceneClip[],
    config?: Partial<SceneAssemblerConfig>,
  ): Promise<RawClip>;
}
