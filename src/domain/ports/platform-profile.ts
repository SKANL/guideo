import type { Audio, FinalVideo, PlatformMetrics, RawClip, Subtitle } from "../models/media.js";

export interface ComposeParams {
  readonly rawClip: RawClip;
  readonly audioTracks: readonly Audio[];
  readonly subtitles: readonly Subtitle[];
  // STABLE caller-provided path the adapter must write the final video to (never a self-chosen
  // temp dir) — see src/app/paths.ts.
  readonly outputPath: string;
}

export interface PlatformProfile {
  compose(params: ComposeParams): Promise<FinalVideo>;
  // Deferred seam (non-goal): engagement metrics feedback loop, referenced-only per spec's
  // plugin-seams requirement. Optional and unused — TikTokProfile/FacebookProfile and any
  // metrics wiring are explicitly out of scope for this slice.
  readonly metrics?: PlatformMetrics;
}
