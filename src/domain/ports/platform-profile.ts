import type { Audio, FinalVideo, PlatformMetrics, RawClip, RenderProfileName, Subtitle } from "../models/media.js";
import type { NarrationMode } from "../models/narration-mode.js";

export interface ComposeParams {
  readonly rawClip: RawClip;
  /** Script timeline endpoint that the physical video must reach when supplied. */
  readonly plannedDurationMs?: number;
  readonly audioTracks: readonly Audio[];
  readonly subtitles: readonly Subtitle[];
  // STABLE caller-provided path the adapter must write the final video to (never a self-chosen
  // temp dir) — see src/app/paths.ts.
  readonly outputPath: string;
  // Narration mode (defaults to "both" when omitted, matching pre-narration-mode behavior):
  // "voice" -> mux audioTracks, no subtitle stream; "both" -> mux audioTracks + soft (mov_text)
  // subtitle stream; "subtitles" -> silent output (no audio), subtitles burned into the video.
  readonly narration?: NarrationMode;
  // Explicit output composition. Omitted keeps the established YouTube 16:9 delivery.
  readonly renderProfile?: RenderProfileName;
}

export interface PlatformProfile {
  compose(params: ComposeParams): Promise<FinalVideo>;
  // Deferred seam (non-goal): engagement metrics feedback loop, referenced-only per spec's
  // plugin-seams requirement. Optional and unused — TikTokProfile/FacebookProfile and any
  // metrics wiring are explicitly out of scope for this slice.
  readonly metrics?: PlatformMetrics;
}
