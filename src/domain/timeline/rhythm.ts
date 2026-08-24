import type { TimedWord } from "../models/media.js";

export type TimelinePause = { readonly startMs: number; readonly endMs: number; readonly kind: "typing" | "loading" | "confirmation" | "comprehension"; readonly intentional: boolean };
export type RhythmBeat = { readonly kind: "speech" | "hold" | "silent"; readonly startMs: number; readonly endMs: number };

/** Functional waits survive unchanged; only explicitly unintentional pauses count as dead air. */
export function classifyDeadAir(pauses: readonly TimelinePause[]): TimelinePause[] {
  return pauses.filter((pause) => !pause.intentional && pause.endMs > pause.startMs);
}

/** Deterministic presentation beats consume available timing only; this never synthesizes audio. */
export function planRhythmBeats(words: readonly TimedWord[], durationMs: number): RhythmBeat[] {
  if (words.length === 0) return [{ kind: "silent", startMs: 0, endMs: durationMs }];
  const startMs = Math.max(0, words[0]!.startMs);
  const endMs = Math.min(durationMs, words.at(-1)!.endMs);
  return [
    ...(startMs > 0 ? [{ kind: "hold" as const, startMs: 0, endMs: startMs }] : []),
    { kind: "speech" as const, startMs, endMs },
    ...(endMs < durationMs ? [{ kind: "hold" as const, startMs: endMs, endMs: durationMs }] : []),
  ];
}
