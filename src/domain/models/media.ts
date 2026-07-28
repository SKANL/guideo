// Minimal result/data shapes produced and consumed by the five ports (src/domain/ports/).
// These are intentionally plain TypeScript interfaces, not zod schemas: nothing in this phase
// produces them from untrusted input (no adapters yet), so there is no parse boundary to guard.
// Phase 4 adapters may add zod validation at their own I/O boundary if/when needed.

// The on-screen time range of one narration-scene inside the recorded clip. startMs/endMs are
// cumulative elapsed milliseconds from the start of the clip, contiguous across scenes (scene N's
// endMs === scene N+1's startMs); the login/overlay-dismiss time before the first storyboard step
// runs counts toward the offset before scene 0 (see WebRecordingEngine.capture()).
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
