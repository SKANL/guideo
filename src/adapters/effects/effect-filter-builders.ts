// Pure ffmpeg filter_complex fragment builders — no I/O, no process spawning. Each builder
// consumes an existing filter_complex link (`inLabel`, e.g. "[0:v]") and produces a new one
// (`outLabel`, e.g. "[v1]"), namespacing any internal labels it needs under `uid` so multiple
// effects chained into one filter_complex graph never collide.
//
// All four effects (design doc section B, effects-overhaul Phase A) are built on ffmpeg patterns
// that are safe to combine with `enable='between(t,a,b)'` (Timeline editing) WITHOUT ever changing
// the negotiated output link size mid-stream — a documented ffmpeg gotcha for filters like
// `crop`/`scale` used directly `enable`-gated on the main stream (their configured output size
// applies for the whole stream, not just while enabled). zoom-in/zoom-out and blur-region instead
// do their size-changing work (crop+scale, crop+boxblur) on a `split` side-branch, and only gate
// the final `overlay` back onto the untouched base stream — overlay never changes the base's size,
// enabled or not. `crop` avoids the problem entirely by not touching viewport size at all: it
// spotlights the region with a gated translucent outline instead of a literal viewport crop.
//
// EVERY builder now takes an already-RESOLVED `region` (spatial target) as an explicit argument —
// callers (effects-graph.ts) resolve it once, combining the capture-time resolved element
// bounding-box (RawClip.resolvedEffects) with a raw-params fallback — rather than each builder
// re-reading effect.params itself. This is the fix for the confirmed root cause of "random/
// meaningless effects": the AI proposes a `selector` but the old builders only ever read
// `level`/`x,y,w,h`, so effects fell back to the frame center/nothing and looked arbitrary.
import type { Effect } from "../../domain/models/effect.js";
import type { EffectRegion } from "../../domain/models/media.js";

export interface FilterGate {
  readonly startSec: number;
  readonly endSec: number;
}

export type FilterBuilder = (
  effect: Effect,
  gate: FilterGate,
  region: EffectRegion | null,
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

// Explicit {x,y,w,h} straight out of effect.params — the fallback effects-graph.ts uses when no
// capture-resolved region exists for an effect (e.g. RawClips built before Phase A, or a clip
// hand-built in a test fixture without going through WebRecordingEngine.capture()).
export function regionFromParams(params: Record<string, unknown>): EffectRegion | null {
  const x = nonNegativeNumber(params.x);
  const y = nonNegativeNumber(params.y);
  const w = positiveNumber(params.w);
  const h = positiveNumber(params.h);
  if (x === null || y === null || w === null || h === null) {
    return null;
  }
  return { x, y, w, h };
}

// 0->1 linear ramp across the gate's own duration (clamped, so the expression stays well-defined
// outside the gate too — the `enable` clause on overlay is what actually hides it there).
function progressExpr(gate: FilterGate): string {
  const duration = gate.endSec - gate.startSec;
  return `min(max((t-${gate.startSec})/${duration},0),1)`;
}

// Animated Ken Burns zoom: `level` ramps from 1 -> defaultLevel (zoom-in) or defaultLevel -> 1
// (zoom-out) across the gate, centered on the RESOLVED REGION's center (falls back to the frame
// center — iw/2, ih/2 — when no region was resolved, matching the old static behavior). `crop`'s
// x/y/w/h expressions containing `t` are already re-evaluated every frame with no extra option
// needed (unlike `scale`, which has its own `eval` option and defaults to evaluating its w/h only
// ONCE — `eval=frame` there is what makes it track the animation frame-by-frame too). Since
// scale's `iw`/`ih` refer to the crop's OUTPUT size (iw_orig/level), multiplying by the identical
// level(t) expression again always cancels back to the original constant frame size, so the
// overlay's negotiated link size never changes mid-stream even though the zoom is animating.
const PROFESSIONAL_ZOOM_MIN = 1.25;
const PROFESSIONAL_ZOOM_MAX = 1.4;

function zoomLevel(value: unknown, defaultLevel: number): number {
  const requested = positiveNumber(value) ?? defaultLevel;
  return Math.min(PROFESSIONAL_ZOOM_MAX, Math.max(PROFESSIONAL_ZOOM_MIN, requested));
}

function buildZoom(defaultLevel: number, reverse: boolean): FilterBuilder {
  return (effect, gate, region, inLabel, outLabel, uid) => {
    // A focal zoom is valid only when capture resolved a target that was visible at action time.
    // Falling back to the frame centre turns an unverified action into arbitrary motion and the
    // dynamic crop can sample outside the source raster near an edge.
    if (region === null) return null;
    const level = zoomLevel(effect.params.level, defaultLevel);
    const p = progressExpr(gate);
    const lvl = reverse ? `(${level}-(${level}-1)*${p})` : `(1+(${level}-1)*${p})`;
    const cx = String(region.x + region.w / 2);
    const cy = String(region.y + region.h / 2);
    const base = `${uid}_base`;
    const src = `${uid}_src`;
    const zoom = `${uid}_zoom`;
    const cropW = `iw/${lvl}`;
    const cropH = `ih/${lvl}`;
    return (
      `${inLabel}split=2[${base}][${src}];` +
      `[${src}]crop=w='${cropW}':h='${cropH}':x='max(0,min(${cx}-(${cropW})/2,iw-(${cropW})))':y='max(0,min(${cy}-(${cropH})/2,ih-(${cropH})))',` +
      `scale=w='iw*${lvl}':h='ih*${lvl}':eval=frame[${zoom}];` +
      `[${base}][${zoom}]overlay=0:0:${enableClause(gate)}${outLabel}`
    );
  };
}

const buildCrop: FilterBuilder = (_effect, gate, region, inLabel, outLabel) => {
  if (region === null) {
    return null;
  }
  const { x, y, w, h } = region;
  const enable = enableClause(gate);
  // Opaque outside masks made physical renders look black/frozen. This preserves the full UI
  // and output dimensions while adding only a deterministic focal outline during the gate.
  return `${inLabel}drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=white@0.9:t=4:${enable}${outLabel}`;
};

const buildBlurRegion: FilterBuilder = (_effect, gate, region, inLabel, outLabel, uid) => {
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

// Scene-boundary transition (effects-overhaul Phase B/C — design doc section B): a short
// cross-dissolve-ish fade, NOT a true two-input `xfade` (that needs two separate input clips;
// this pipeline composes one continuous/cut clip, so there is nothing to cross-fade BETWEEN at
// the ffmpeg-filter level). Pragmatic stand-in: fade to/from black at the scene's own edge, over
// `params.durationSec`. The Director (director.ts) pairs two of these per boundary — a `edge:"out"`
// on the OUTGOING scene's last step (fades out ending at that scene's gate.endSec) and an
// `edge:"in"` on the INCOMING scene's first step (fades in starting at that scene's gate.startSec)
// — so a boundary reads as fade-out-then-fade-in across the cut. Upgrade path: if/when clips are
// composed from genuinely separate source segments (not one continuous recording), swap this for a
// real `xfade` between the two segments' filter graphs instead of the fade-to-black stand-in.
// Ignores `region` entirely — a transition never depends on the effect's spatial target.
const DEFAULT_TRANSITION_DURATION_SEC = 0.5;

const buildTransition: FilterBuilder = (effect, gate, _region, inLabel, outLabel) => {
  const edge = effect.params.edge;
  if (edge !== "in" && edge !== "out") {
    return null;
  }
  const requestedDuration = positiveNumber(effect.params.durationSec);
  const duration = requestedDuration ?? DEFAULT_TRANSITION_DURATION_SEC;
  const start = edge === "out" ? gate.endSec - duration : gate.startSec;
  return `${inLabel}fade=t=${edge}:st=${start}:d=${duration}:color=black${outLabel}`;
};

// Registry: effect type -> pure filter_complex fragment builder. To add a new effect type:
//   1. Add its string literal to EffectTypeSchema (domain/models/effect.ts).
//   2. Write a `FilterBuilder` here (pure — no I/O) and add it to this map, keyed by that type.
//   3. Optional: give it a tasteful default in director.ts (domain/pipeline/director.ts) if it
//      should be applied automatically rather than only ever AI/human-proposed.
// That's it — effects-graph.ts and ffmpeg-effects.ts look builders up generically by `effect.type`,
// nothing else needs to change.
export const filterBuilderRegistry: Readonly<Record<string, FilterBuilder>> = {
  "zoom-in": buildZoom(1.3, false),
  "zoom-out": buildZoom(1.3, true),
  crop: buildCrop,
  "blur-region": buildBlurRegion,
  transition: buildTransition,
};
