// Minimal result/data shapes produced and consumed by the five ports (src/domain/ports/).
// These are intentionally plain TypeScript interfaces, not zod schemas: nothing in this phase
// produces them from untrusted input (no adapters yet), so there is no parse boundary to guard.
// Phase 4 adapters may add zod validation at their own I/O boundary if/when needed.

// The on-screen time range of one narration-scene inside the recorded clip. startMs/endMs are
// cumulative elapsed milliseconds from the start of SCENE 0 (0-based), contiguous across scenes
// (scene N's endMs === scene N+1's startMs; scene 0's startMs === 0). The login/overlay-dismiss
// time before the first storyboard step is tracked separately on RawClip.preRollMs, NOT folded
// into these ranges — see WebRecordingEngine.capture() and trim-preroll.ts (design doc section C:
// the pre-roll trim removes that footage before the shown output, so effects/subtitles/audio,
// all keyed to these 0-based ranges, stay aligned to the trimmed clip).
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
}

export interface Audio {
  readonly segmentId: string;
  readonly path: string;
  readonly durationMs: number;
}

export interface Subtitle {
  readonly text: string;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface FinalVideo {
  readonly path: string;
  readonly aspectRatio: "16:9";
}

// Deferred seam (non-goal): engagement metrics feedback loop, referenced-only per spec's
// plugin-seams requirement. Typed but never populated or read this slice.
export interface PlatformMetrics {
  readonly views?: number;
  readonly retentionRate?: number;
}
