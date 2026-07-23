import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUMAN_FEEL_CONFIG,
  type HumanFeelConfig,
} from "../../../src/adapters/recording/human-feel-config.js";
import {
  easedMousePath,
  naturalPauseMs,
  typingDelays,
} from "../../../src/adapters/recording/humanize.js";
import { SeededRandom } from "../../../src/adapters/recording/seeded-random.js";

describe("easedMousePath", () => {
  it("produces a step count within the configured bounds", () => {
    const config: HumanFeelConfig = {
      ...DEFAULT_HUMAN_FEEL_CONFIG,
      mouseSteps: { min: 10, max: 20 },
    };
    const rng = new SeededRandom(1);
    const path = easedMousePath(rng, { x: 0, y: 0 }, { x: 500, y: 300 }, config);
    expect(path.length).toBeGreaterThanOrEqual(10);
    expect(path.length).toBeLessThanOrEqual(20);
  });

  it("lands exactly on the target as its last point", () => {
    const config: HumanFeelConfig = {
      ...DEFAULT_HUMAN_FEEL_CONFIG,
      mouseSteps: { min: 8, max: 8 },
    };
    const rng = new SeededRandom(2);
    const to = { x: 400, y: 250 };
    const path = easedMousePath(rng, { x: 0, y: 0 }, to, config);
    expect(path[path.length - 1]?.point).toEqual(to);
  });

  it("is not a single teleport — intermediate points progress monotonically toward the target", () => {
    // mouseOvershoot: 0 makes the bezier control points collinear with the straight line, so
    // distance-to-target strictly decreases point over point — deterministic under a fixed seed.
    const config: HumanFeelConfig = {
      ...DEFAULT_HUMAN_FEEL_CONFIG,
      mouseSteps: { min: 6, max: 6 },
      mouseOvershoot: 0,
    };
    const rng = new SeededRandom(3);
    const from = { x: 0, y: 0 };
    const to = { x: 600, y: 0 };
    const path = easedMousePath(rng, from, to, config);

    expect(path.length).toBe(6);
    const distances = path.map((step) => Math.hypot(to.x - step.point.x, to.y - step.point.y));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThan(distances[i - 1] as number);
    }
    expect(distances[distances.length - 1]).toBe(0);
  });

  it("each move step carries a pacing delay within configured bounds", () => {
    const config: HumanFeelConfig = {
      ...DEFAULT_HUMAN_FEEL_CONFIG,
      mouseSteps: { min: 15, max: 15 },
      mouseStepDelayMs: { min: 4, max: 12 },
    };
    const rng = new SeededRandom(4);
    const path = easedMousePath(rng, { x: 0, y: 0 }, { x: 100, y: 100 }, config);
    for (const step of path) {
      expect(step.delayMs).toBeGreaterThanOrEqual(4);
      expect(step.delayMs).toBeLessThanOrEqual(12);
    }
  });

  it("is deterministic under a fixed seed", () => {
    const config = DEFAULT_HUMAN_FEEL_CONFIG;
    const pathA = easedMousePath(new SeededRandom(99), { x: 0, y: 0 }, { x: 300, y: 200 }, config);
    const pathB = easedMousePath(new SeededRandom(99), { x: 0, y: 0 }, { x: 300, y: 200 }, config);
    expect(pathA).toEqual(pathB);
  });
});

describe("typingDelays", () => {
  it("returns one delay per character, within configured bounds", () => {
    const config: HumanFeelConfig = {
      ...DEFAULT_HUMAN_FEEL_CONFIG,
      typingDelayMs: { mean: 90, stdDev: 35, min: 30, max: 220 },
    };
    const rng = new SeededRandom(11);
    const delays = typingDelays(rng, 40, config);
    expect(delays.length).toBe(40);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(30);
      expect(delay).toBeLessThanOrEqual(220);
    }
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it("is deterministic under a fixed seed", () => {
    const config = DEFAULT_HUMAN_FEEL_CONFIG;
    const a = typingDelays(new SeededRandom(5), 20, config);
    const b = typingDelays(new SeededRandom(5), 20, config);
    expect(a).toEqual(b);
  });
});

describe("naturalPauseMs", () => {
  it("stays within configured bounds and varies across calls", () => {
    const config: HumanFeelConfig = {
      ...DEFAULT_HUMAN_FEEL_CONFIG,
      pauseMs: { min: 250, max: 900 },
    };
    const rng = new SeededRandom(21);
    const pauses = Array.from({ length: 30 }, () => naturalPauseMs(rng, config));
    for (const pause of pauses) {
      expect(pause).toBeGreaterThanOrEqual(250);
      expect(pause).toBeLessThan(900);
    }
    expect(new Set(pauses).size).toBeGreaterThan(1);
  });

  it("is deterministic under a fixed seed", () => {
    const config = DEFAULT_HUMAN_FEEL_CONFIG;
    expect(naturalPauseMs(new SeededRandom(3), config)).toBe(
      naturalPauseMs(new SeededRandom(3), config),
    );
  });
});
