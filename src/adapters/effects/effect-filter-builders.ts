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
// spotlights the region with four gated black `drawbox` bars instead of a literal viewport crop.
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
function buildZoom(defaultLevel: number, reverse: boolean): FilterBuilder {
  return (effect, gate, region, inLabel, outLabel, uid) => {
    const requested = positiveNumber(effect.params.level);
    const level = requested !== null && requested > 1 ? requested : defaultLevel;
    const p = progressExpr(gate);
    const lvl = reverse ? `(${level}-(${level}-1)*${p})` : `(1+(${level}-1)*${p})`;
    const cx = region ? String(region.x + region.w / 2) : "iw/2";
    const cy = region ? String(region.y + region.h / 2) : "ih/2";
    const base = `${uid}_base`;
    const src = `${uid}_src`;
    const zoom = `${uid}_zoom`;
    const cropW = `iw/${lvl}`;
    const cropH = `ih/${lvl}`;
    return (
      `${inLabel}split=2[${base}][${src}];` +
      `[${src}]crop=w='${cropW}':h='${cropH}':x='${cx}-(${cropW})/2':y='${cy}-(${cropH})/2',` +
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
  return (
    `${inLabel}` +
    `drawbox=x=0:y=0:w=iw:h=${y}:color=black:t=fill:${enable},` +
    `drawbox=x=0:y=${y + h}:w=iw:h=ih-${y + h}:color=black:t=fill:${enable},` +
    `drawbox=x=0:y=${y}:w=${x}:h=${h}:color=black:t=fill:${enable},` +
    `drawbox=x=${x + w}:y=${y}:w=iw-${x + w}:h=${h}:color=black:t=fill:${enable}` +
    `${outLabel}`
  );
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

export const filterBuilderRegistry: Readonly<Record<string, FilterBuilder>> = {
  "zoom-in": buildZoom(1.3, false),
  "zoom-out": buildZoom(1.3, true),
  crop: buildCrop,
  "blur-region": buildBlurRegion,
};
