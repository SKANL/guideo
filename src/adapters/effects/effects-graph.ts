// Pure: maps an ApprovedStoryboard's per-step AI-proposed effects onto a SINGLE scene clip's own
// whole timeline (per-scene-clip architecture) and threads them into ONE filter_complex chain. No
// I/O, no process spawning — see ffmpeg-effects.ts for the adapter that actually runs this graph
// through ffmpeg.
import type { EffectRegion, RawClip } from "../../domain/models/media.js";
import type { ApprovedStoryboard } from "../../domain/models/storyboard.js";
import type { SceneClip } from "../../domain/ports/scene-splitter.js";
import { filterBuilderRegistry, regionFromParams } from "./effect-filter-builders.js";

export interface EffectsGraph {
  readonly filterComplex: string;
  readonly outputLabel: string;
}

function effectGate(
  effect: { params: Record<string, unknown> },
  sceneDurationMs: number,
): { startSec: number; endSec: number } {
  const entryMs = effect.params.entryMs;
  const exitMs = effect.params.exitMs;
  if (
    typeof entryMs === "number" &&
    Number.isFinite(entryMs) &&
    typeof exitMs === "number" &&
    Number.isFinite(exitMs) &&
    exitMs > entryMs
  ) {
    return {
      startSec: Math.max(0, entryMs) / 1000,
      endSec: Math.min(sceneDurationMs, exitMs) / 1000,
    };
  }
  return { startSec: 0, endSec: sceneDurationMs / 1000 };
}

// Combines the SPATIAL target with the TIME gate (effects-overhaul Phase A): prefers the region
// resolved at capture time (clip.resolvedEffects[index], captured while the target element was
// actually on screen — see WebRecordingEngine.capture()); falls back to reading an explicit
// {x,y,w,h} straight from effect.params when the clip carries no resolvedEffects data at all
// (older RawClips, hand-built test fixtures). `index` is positional — the Nth effect encountered
// while iterating storyboard.steps in order, the same order capture() resolves in.
function resolveRegion(
  clip: RawClip,
  index: number,
  effect: { params: Record<string, unknown> },
): EffectRegion | null {
  if (clip.resolvedEffects) {
    return clip.resolvedEffects[index]?.region ?? null;
  }
  return regionFromParams(effect.params);
}

// Returns null when there is nothing to apply to THIS scene — either no step in the whole
// storyboard belongs to it and declares an effect, or every declared effect turned out unmatched/
// unknown/malformed (each such case is logged and skipped, never thrown) — the caller treats null
// as "run no ffmpeg, passthrough the scene clip unchanged".
//
// Per-scene-clip architecture: `sceneClip` is exactly one narration beat's OWN standalone file (see
// scene-splitter.ts), so every matching effect gates over the WHOLE scene clip — [0, durationMs] on
// ITS OWN local timeline, not the original shared clip's [startMs,endMs] range. The spatial target
// (resolved region) is unchanged: still read positionally off `clip.resolvedEffects`, which stays
// indexed across ALL of the ORIGINAL clip's storyboard.steps (the order WebRecordingEngine.capture()
// resolved them in) — so this walks every step, advancing the position counter even for steps
// belonging to OTHER scenes, to stay aligned.
export function buildSceneEffectsGraph(
  clip: RawClip,
  sceneClip: SceneClip,
  storyboard: ApprovedStoryboard,
): EffectsGraph | null {
  const fragments: string[] = [];
  let currentLabel = "[0:v]";
  let uid = 0;
  // Global positional index across ALL of the original clip's steps' effects, in storyboard
  // order — must line up with clip.resolvedEffects regardless of which scene a step belongs to.
  let effectIndex = -1;

  for (const step of storyboard.steps) {
    if (step.effects.length === 0) {
      continue;
    }
    if (step.narrationSegmentId !== sceneClip.narrationSegmentId) {
      effectIndex += step.effects.length;
      continue;
    }

    for (const effect of step.effects) {
      effectIndex += 1;
      const builder = filterBuilderRegistry[effect.type];
      if (!builder) {
        console.warn(`[effects] skipping unknown effect type "${effect.type}".`);
        continue;
      }
      const region = resolveRegion(clip, effectIndex, effect);
      uid += 1;
      const nextLabel = `[v${uid}]`;
      const fragment = builder(
        effect,
        effectGate(effect, sceneClip.durationMs),
        region,
        currentLabel,
        nextLabel,
        `e${uid}`,
      );
      if (fragment === null) {
        console.warn(`[effects] skipping malformed "${effect.type}" effect params.`);
        continue;
      }
      fragments.push(fragment);
      currentLabel = nextLabel;
    }
  }

  if (fragments.length === 0) {
    return null;
  }

  return { filterComplex: fragments.join(";"), outputLabel: currentLabel };
}
