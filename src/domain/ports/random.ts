// Random — seedable deterministic RNG port. Domain-level so consumers (e.g. adapters/recording's
// humanize.ts) depend on this interface, never a concrete RNG implementation. A seeded adapter
// implementation (Phase 4: SeededRandom) makes human-feel motion/typing reproducible under tests
// while a differently-seeded (or time-seeded) instance gives real captures natural variation.
export interface Random {
  // Returns a float in [0, 1).
  next(): number;
  // Returns an integer in [min, max], inclusive on both ends.
  int(min: number, max: number): number;
  // Returns a float in [min, max).
  float(min: number, max: number): number;
  // Returns a normally-distributed value (Box-Muller) with the given mean/stdDev.
  gaussian(mean: number, stdDev: number): number;
}
