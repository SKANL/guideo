import type { RawClip } from "../models/media.js";
import type { SceneClip } from "./scene-splitter.js";

export interface SceneAssemblerConfig {
  readonly transitionDurationSec: number;
  // "xfade" (default): real crossfade — consecutive clips OVERLAP by transitionDurationSec via
  // ffmpeg's `xfade` filter, so total duration shrinks to sum(durations) − (N−1)·transitionDurationSec
  // and the returned `scenes` ranges overlap at each boundary (see FfmpegSceneAssembler's
  // rebaseScenesXfade). "dip": the original duration-preserving local fade-in/fade-out + concat,
  // kept as a fallback — no overlap, contiguous scenes, unchanged total duration.
  readonly transitionStyle?: "dip" | "xfade";
}

// SceneAssembler — per-scene-clip architecture Phase 1. assemble() composes the per-scene clips
// SceneSplitter produced back into ONE RawClip. Default "xfade" style crossfades consecutive clips
// (real overlap, total duration shrinks — see SceneAssemblerConfig.transitionStyle); "dip" style
// applies a duration-preserving local fade-in/fade-out at every scene boundary then concatenates
// with no overlap. Either way the returned RawClip's `scenes` are recomputed ranges over the
// assembled clip in the same order/narrationSegmentIds as the input sceneClips (contiguous for
// "dip", overlap-adjusted for "xfade"). A single sceneClip is a safe passthrough regardless of
// style: no transition, no re-encode.
export interface SceneAssembler {
  assemble(
    sceneClips: readonly SceneClip[],
    config?: Partial<SceneAssemblerConfig>,
  ): Promise<RawClip>;
}
