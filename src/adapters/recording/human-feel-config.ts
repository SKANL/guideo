// HumanFeelConfig — calibration knobs for humanize.ts. Human-feel motion/typing is a knob, not a
// magic constant: the physical/visual "does this look human" bar is something a minimal model
// can't predict up front, so every range here is deliberately left tunable per-instance (same
// pattern as DiscoveryConfig / VoiceCalibration) rather than hard-coded inside humanize.ts.
export interface HumanFeelConfig {
  // Number of intermediate points in an eased mouse move between two coordinates.
  readonly mouseSteps: { readonly min: number; readonly max: number };
  // Pacing delay (ms) awaited before each individual mouse-move point — what actually paces the
  // motion in real time during a recording (a fake test double just resolves this instantly).
  readonly mouseStepDelayMs: { readonly min: number; readonly max: number };
  // 0..1 — how far the bezier control points may randomly bow off the straight line, relative to
  // move distance. 0 = perfectly straight/linear; higher = more visible arc/overshoot.
  readonly mouseOvershoot: number;
  // Per-keystroke delay (ms), gaussian around `mean` with `stdDev`, clamped to [min, max].
  readonly typingDelayMs: {
    readonly mean: number;
    readonly stdDev: number;
    readonly min: number;
    readonly max: number;
  };
  // Natural pause (ms) inserted between storyboard actions.
  readonly pauseMs: { readonly min: number; readonly max: number };
}

export const DEFAULT_HUMAN_FEEL_CONFIG: HumanFeelConfig = {
  mouseSteps: { min: 12, max: 24 },
  mouseStepDelayMs: { min: 4, max: 14 },
  mouseOvershoot: 0.12,
  typingDelayMs: { mean: 90, stdDev: 35, min: 30, max: 220 },
  pauseMs: { min: 250, max: 900 },
};
