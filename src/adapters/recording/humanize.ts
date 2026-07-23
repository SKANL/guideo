// humanize.ts — pure, deterministic-under-a-seed functions producing human-feel motion/typing/
// pause data. Every function here takes a Random port instance (never touches Math.random or any
// I/O) so WebRecordingEngine can drive real patchright calls from their output while unit tests
// get fully reproducible values from a SeededRandom.
import type { Random } from "../../domain/ports/random.js";
import type { HumanFeelConfig } from "./human-feel-config.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface MouseMoveStep {
  readonly point: Point;
  // How long to wait before performing this move — paces the motion in real time.
  readonly delayMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

// Eased mouse path: a cubic-bezier curve of intermediate points between `from` and `to`, each
// paired with a pacing delay. Control points sit at 1/3 and 2/3 of the straight line, nudged by up
// to `mouseOvershoot * distance` for a natural arc; overshoot 0 degenerates to a straight line
// (still multiple points, just linearly interpolated — see the "not a teleport" test).
export function easedMousePath(
  random: Random,
  from: Point,
  to: Point,
  config: HumanFeelConfig,
): MouseMoveStep[] {
  const steps = random.int(config.mouseSteps.min, config.mouseSteps.max);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const offset = config.mouseOvershoot * distance;

  const control1: Point = {
    x: from.x + dx / 3 + (random.next() - 0.5) * offset,
    y: from.y + dy / 3 + (random.next() - 0.5) * offset,
  };
  const control2: Point = {
    x: from.x + (dx * 2) / 3 + (random.next() - 0.5) * offset,
    y: from.y + (dy * 2) / 3 + (random.next() - 0.5) * offset,
  };

  const path: MouseMoveStep[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    path.push({
      point: cubicBezierPoint(from, control1, control2, to, t),
      delayMs: random.float(config.mouseStepDelayMs.min, config.mouseStepDelayMs.max),
    });
  }

  // Bezier float math can drift a fraction of a pixel short of `to` at t=1 — snap the last point
  // exactly onto the target so capture() always ends precisely where the storyboard step intends.
  const last = path[path.length - 1];
  if (last) {
    path[path.length - 1] = { ...last, point: to };
  }
  return path;
}

// Per-keystroke delays (ms), one per character, gaussian-jittered around the configured mean and
// clamped to [min, max]. Takes a character count rather than the text itself — purely a duration
// generator, decoupled from what's actually being typed.
export function typingDelays(random: Random, charCount: number, config: HumanFeelConfig): number[] {
  const { mean, stdDev, min, max } = config.typingDelayMs;
  return Array.from({ length: charCount }, () => clamp(random.gaussian(mean, stdDev), min, max));
}

// A natural pause duration (ms) between storyboard actions.
export function naturalPauseMs(random: Random, config: HumanFeelConfig): number {
  return random.float(config.pauseMs.min, config.pauseMs.max);
}
