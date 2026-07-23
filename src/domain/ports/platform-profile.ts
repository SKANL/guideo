import type { Audio, FinalVideo, PlatformMetrics, RawClip, Subtitle } from "../models/media.js";

export interface ComposeParams {
  readonly rawClip: RawClip;
  readonly audioTracks: readonly Audio[];
  readonly subtitles: readonly Subtitle[];
}

export interface PlatformProfile {
  compose(params: ComposeParams): Promise<FinalVideo>;
  // Deferred seam (non-goal): engagement metrics feedback loop, referenced-only per spec's
  // plugin-seams requirement. Optional and unused — TikTokProfile/FacebookProfile and any
  // metrics wiring are explicitly out of scope for this slice.
  readonly metrics?: PlatformMetrics;
}
