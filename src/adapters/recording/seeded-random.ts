// SeededRandom — the one concrete implementation of the domain's Random port for this slice.
// mulberry32 PRNG: tiny, fast, and (unlike Math.random) fully deterministic given a seed — the
// same seed always produces the same next()/int()/float()/gaussian() sequence, which is what
// makes humanize.ts's mouse/typing/pause output reproducible under a fixed seed in tests, while a
// differently-seeded (or time-seeded) instance gives real captures natural, non-repeating motion.
import type { Random } from "../../domain/ports/random.js";

export class SeededRandom implements Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  // Box-Muller transform (polar form skipped — the basic form is plenty for humanize's use).
  gaussian(mean: number, stdDev: number): number {
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }
}
