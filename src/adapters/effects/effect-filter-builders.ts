// Pure ffmpeg filter_complex fragment builders — no I/O, no process spawning. Each builder
// consumes an existing filter_complex link (`inLabel`, e.g. "[0:v]") and produces a new one
// (`outLabel`, e.g. "[v1]"), namespacing any internal labels it needs under `uid` so multiple
// effects chained into one filter_complex graph never collide.
//
// All three basic v2 effects (design doc section B) are built on ffmpeg patterns that are safe to
// combine with `enable='between(t,a,b)'` (Timeline editing) WITHOUT ever changing the negotiated
// output link size mid-stream — a documented ffmpeg gotcha for filters like `crop`/`scale` used
// directly `enable`-gated on the main stream (their configured output size applies for the whole
// stream, not just while enabled). zoom-in/zoom-out and blur-region instead do their size-changing
// work (crop+scale, crop+boxblur) on a `split` side-branch at a CONSTANT size, and only gate the
// final `overlay` back onto the untouched base stream — overlay never changes the base's size,
// enabled or not. `crop` avoids the problem entirely by not touching viewport size at all: it
// spotlights the region with four gated black `drawbox` bars instead of a literal viewport crop.
import type { Effect } from "../../domain/models/effect.js";

export interface FilterGate {
  readonly startSec: number;
  readonly endSec: number;
}

export type FilterBuilder = (
  effect: Effect,
  gate: FilterGate,
  inLabel: string,
  outLabel: string,
  uid: string,
) => string | null;

function enableClause(gate: FilterGate): string {
  return `enable='between(t,${gate.startSec},${gate.endSec})'`;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// zoom-in / zoom-out share one steady digital-zoom mechanism (crop a centered region, scale back
// up to fill the frame) — a genuine optical "zoom out" beyond the recorded frame isn't derivable
// from fixed-resolution footage without extra margin, so both types render identically today,
// differing only in their default magnitude.
// ponytail: an animated Ken Burns pan/zoom (the level changing over the scene) is a later upgrade
// (design doc section B: "full animated Ken Burns is a later upgrade"); this is the steady,
// non-animated version.
function buildZoom(defaultLevel: number): FilterBuilder {
  return (effect, gate, inLabel, outLabel, uid) => {
    const requested = positiveNumber(effect.params.level);
    const level = requested !== null && requested > 1 ? requested : defaultLevel;
    const base = `${uid}_base`;
    const src = `${uid}_src`;
    const zoom = `${uid}_zoom`;
    return (
      `${inLabel}split=2[${base}][${src}];` +
      `[${src}]crop=iw/${level}:ih/${level}:(iw-iw/${level})/2:(ih-ih/${level})/2,scale=iw*${level}:ih*${level}[${zoom}];` +
      `[${base}][${zoom}]overlay=0:0:${enableClause(gate)}${outLabel}`
    );
  };
}

function readRegion(
  params: Record<string, unknown>,
): { x: number; y: number; w: number; h: number } | null {
  const x = nonNegativeNumber(params.x);
  const y = nonNegativeNumber(params.y);
  const w = positiveNumber(params.w);
  const h = positiveNumber(params.h);
  if (x === null || y === null || w === null || h === null) {
    return null;
  }
  return { x, y, w, h };
}

const buildCrop: FilterBuilder = (effect, gate, inLabel, outLabel) => {
  const region = readRegion(effect.params);
  if (region === null) {
    return null;
  }
  const { x, y, w, h } = region;
  const enable = enableClause(gate);
  return (
    `${inLabel}` +
    `drawbox=x=0:y=0:w=iw:h=${y}:color=black:t=fill:${enable},` +
    `drawbox=x=0:y=${y + h}:w=iw:h=ih-${y + h}:color=black:t=fill:${enable},` +
    `drawbox=x=0:y=${y}:w=${x}:h=${h}:color=black:t=fill:${enable},` +
    `drawbox=x=${x + w}:y=${y}:w=iw-${x + w}:h=${h}:color=black:t=fill:${enable}` +
    `${outLabel}`
  );
};

const buildBlurRegion: FilterBuilder = (effect, gate, inLabel, outLabel, uid) => {
  const region = readRegion(effect.params);
  if (region === null) {
    return null;
  }
  const { x, y, w, h } = region;
  const base = `${uid}_base`;
  const src = `${uid}_src`;
  const blurred = `${uid}_blur`;
  return (
    `${inLabel}split=2[${base}][${src}];` +
    `[${src}]crop=${w}:${h}:${x}:${y},boxblur=10[${blurred}];` +
    `[${base}][${blurred}]overlay=${x}:${y}:${enableClause(gate)}${outLabel}`
  );
};

export const filterBuilderRegistry: Readonly<Record<string, FilterBuilder>> = {
  "zoom-in": buildZoom(1.3),
  "zoom-out": buildZoom(1.15),
  crop: buildCrop,
  "blur-region": buildBlurRegion,
};
