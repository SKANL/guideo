import { describe, expect, it } from "vitest";
import { SeededRandom } from "../../../src/adapters/recording/seeded-random.js";

describe("SeededRandom", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("diverges for different seeds", () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() stays within [0, 1)", () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 200; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("int() is inclusive of both bounds and stays within range", () => {
    const rng = new SeededRandom(123);
    const values = Array.from({ length: 200 }, () => rng.int(1, 3));
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(3);
    }
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("float() stays within [min, max)", () => {
    const rng = new SeededRandom(9);
    for (let i = 0; i < 100; i++) {
      const value = rng.float(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(20);
    }
  });

  it("gaussian() clusters around the mean and varies", () => {
    const rng = new SeededRandom(55);
    const values = Array.from({ length: 500 }, () => rng.gaussian(100, 10));
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(avg).toBeGreaterThan(90);
    expect(avg).toBeLessThan(110);
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});
