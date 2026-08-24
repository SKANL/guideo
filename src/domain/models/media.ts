// Minimal result/data shapes produced and consumed by the five ports (src/domain/ports/).
// These are intentionally plain TypeScript interfaces, not zod schemas: nothing in this phase
// produces them from untrusted input (no adapters yet), so there is no parse boundary to guard.
// Phase 4 adapters may add zod validation at their own I/O boundary if/when needed.

// The on-screen time range of one narration-scene inside the recorded clip. startMs/endMs are
// cumulative elapsed milliseconds from the start of SCENE 0 (0-based). With a duration-preserving
// "dip" assembly these are CONTIGUOUS (scene N's endMs === scene N+1's startMs; scene 0's startMs
// === 0). With an overlap-consuming "xfade" assembly (FfmpegSceneAssembler's default — see its
// rebaseScenesXfade doc comment) consecutive ranges OVERLAP by exactly transitionDurationSec: scene
// N's endMs > scene N+1's startMs during the crossfade window, since both scenes are genuinely
// on-screen (blended) then. The login/overlay-dismiss time before the first storyboard step is
// tracked separately on RawClip.preRollMs, NOT folded into these ranges — see
// WebRecordingEngine.capture() and trim-preroll.ts (design doc section C: the pre-roll trim removes
// that footage before the shown output, so effects/subtitles/audio, all keyed to these 0-based
// ranges, stay aligned to the trimmed clip).
export interface SceneRange {
  readonly narrationSegmentId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface RawClip {
  readonly path: string;
  readonly durationMs: number;
  readonly aspectRatio: "16:9";
  readonly scenes: readonly SceneRange[];
  // Real wall-clock milliseconds recorded between the start of the video recording (context
  // creation) and the first scene's first action — i.e. the login + overlay-dismiss footage at
  // the front of the raw clip. Measured via an injectable clock (see WebRecordingEngine), not the
  // synthetic pacing sums scenes[*] are built from. 0 when there was no measurable delay.
  readonly preRollMs: number;
  // Per-effect spatial TARGET resolved at CAPTURE time (effects-overhaul Phase A: fixes effects
  // that used to always zoom the frame center regardless of the AI-proposed `selector`). While
  // running each step, for every effect on that step, its `params.selector` (if any) is resolved
  // via page.$(selector)?.boundingBox() — the element is actually on screen then; an explicit
  // {x,y,w,h} in params passes through unchanged; otherwise the region is null (caller falls back
  // to frame-center/whole-frame). Stored POSITIONALLY: entry N here is the Nth effect encountered
  // while iterating storyboard.steps in declaration order (steps, then each step's effects) — the
  // same order buildSceneEffectsGraph iterates (see effects-graph.ts), so the two line up without
  // a synthetic key. Optional for backward compatibility with RawClips built before this field
  // existed (e.g. hand-built test fixtures) — buildSceneEffectsGraph falls back to reading an
  // explicit region straight from effect.params when this is undefined.
  //
  // These are PIXEL regions only (spatial) — TIME still comes from clip.scenes, which
  // trim-preroll/cut-private rebase; the output stays 1280x720 throughout so a resolved region
  // stays valid across those rebases.
  readonly resolvedEffects?: readonly ResolvedEffect[];
  // Capture recovery evidence is intentionally bounded. It supports a diagnostic/resume handoff
  // without persisting unbounded browser logs or screenshots for long storyboards.
  readonly captureEvidence?: CaptureEvidence;
  readonly provenance?: { readonly schema: string; readonly version: number; readonly sha256: string };
}

export interface CaptureTrace {
  readonly stepIndex: number;
  readonly action: string;
  readonly url: string;
}

export interface CaptureCheckpoint {
  readonly runId: string;
  readonly inputSha256: string;
  readonly completedStepIndex: number;
  readonly url: string;
}

export interface CaptureEvidence {
  readonly traces: readonly CaptureTrace[];
  readonly screenshots: readonly string[];
  readonly checkpoints: readonly CaptureCheckpoint[];
  readonly resume?: { readonly nextStepIndex: number; readonly url: string };
}

export interface EffectRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ResolvedEffect {
  readonly narrationSegmentId: string;
  readonly type: string;
  readonly region: EffectRegion | null;
}

export interface Audio {
  readonly segmentId: string;
  readonly path: string;
  readonly durationMs: number;
  /** Provider timings are preferred; deterministic planned timings are explicitly approximate. */
  readonly speech?: SpeechTrack;
  readonly provenance?: AudioProvenance;
}

export interface TimedWord { readonly text: string; readonly startMs: number; readonly endMs: number; }
export interface SpeechTrack { readonly words: readonly TimedWord[]; readonly approximate: boolean; }
export interface AudioProvenance {
  readonly audioSha256: string;
  readonly provider: string;
  readonly model: string;
  readonly voiceId: string;
  readonly seed?: number;
  readonly measuredCost: { readonly unit: "usd-micros"; readonly amount: number; readonly cache: "hit" | "miss" };
}

export interface Subtitle {
  readonly text: string;
  readonly startMs: number;
  readonly durationMs: number;
}

/** Delivery composition remains explicit while a raw browser capture stays 16:9. */
export type RenderProfileName = "youtube" | "shorts" | "square";
const RENDER_PROFILE_NAMES: readonly RenderProfileName[] = ["youtube", "shorts", "square"];

export function parseRenderProfileName(value: string): RenderProfileName {
  if (!(RENDER_PROFILE_NAMES as readonly string[]).includes(value)) {
    throw new Error(`Invalid --profile value "${value}" (expected one of: ${RENDER_PROFILE_NAMES.join(", ")}).`);
  }
  return value as RenderProfileName;
}

export type DeliveryAspectRatio = "16:9" | "9:16" | "1:1";

export interface FinalVideo {
  readonly path: string;
  readonly aspectRatio: DeliveryAspectRatio;
  readonly provenance?: { readonly schema: string; readonly version: number; readonly sha256: string };
}

// Deferred seam (non-goal): engagement metrics feedback loop, referenced-only per spec's
// plugin-seams requirement. Typed but never populated or read this slice.
export interface PlatformMetrics {
  readonly views?: number;
  readonly retentionRate?: number;
}
