// Minimal result/data shapes produced and consumed by the five ports (src/domain/ports/).
// These are intentionally plain TypeScript interfaces, not zod schemas: nothing in this phase
// produces them from untrusted input (no adapters yet), so there is no parse boundary to guard.
// Phase 4 adapters may add zod validation at their own I/O boundary if/when needed.

export interface RawClip {
  readonly path: string;
  readonly durationMs: number;
  readonly aspectRatio: "16:9";
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
