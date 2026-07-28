import type { RawClip } from "../models/media.js";

// One extracted scene, its own standalone clip file (per-scene-clip architecture Phase 1).
export interface SceneClip {
  readonly narrationSegmentId: string;
  readonly path: string;
  readonly durationMs: number;
}

// SceneSplitter — per-scene-clip architecture Phase 1. Correct duration-preserving transitions
// need each scene as its OWN clip file rather than gated against one continuous/cut clip's shared
// timeline (a shared-timeline `fade=in:st=T` renders everything before T black across the WHOLE
// video — see director.ts's history). split() extracts each of clip.scenes[*]'s [startMs,endMs)
// range into its own file, in order. If clip.scenes is empty, returns a single SceneClip covering
// the whole input (safe passthrough for a single-scene/no-scene clip).
export interface SceneSplitter {
  split(clip: RawClip): Promise<SceneClip[]>;
}
