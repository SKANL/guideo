// Pure: maps an ApprovedStoryboard's per-step AI-proposed effects onto their step's scene time
// range (matched via narrationSegmentId -> clip.scenes[*]) and threads them into ONE
// filter_complex chain. No I/O, no process spawning — see ffmpeg-effects.ts for the adapter that
// actually runs this graph through ffmpeg.
import type { EffectRegion, RawClip } from "../../domain/models/media.js";
import type { ApprovedStoryboard } from "../../domain/models/storyboard.js";
import { filterBuilderRegistry, regionFromParams } from "./effect-filter-builders.js";

export interface EffectsGraph {
  readonly filterComplex: string;
  readonly outputLabel: string;
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

// Returns null when there is nothing to apply — either no step declared any effects, or every
// declared effect turned out unmatched/unknown/malformed (each such case is logged and skipped,
// never thrown) — the caller treats null as "run no ffmpeg, passthrough the input clip unchanged".
export function buildEffectsGraph(
  clip: RawClip,
  storyboard: ApprovedStoryboard,
): EffectsGraph | null {
  const scenesBySegment = new Map(clip.scenes.map((scene) => [scene.narrationSegmentId, scene]));

  const fragments: string[] = [];
  let currentLabel = "[0:v]";
  let uid = 0;
  // Global positional index across ALL steps' effects, in storyboard order — must line up with
  // clip.resolvedEffects regardless of whether a given step's scene is later found/skipped below.
  let effectIndex = -1;

  for (const step of storyboard.steps) {
    if (step.effects.length === 0) {
      continue;
    }
    const scene = scenesBySegment.get(step.narrationSegmentId);
    if (!scene) {
      console.warn(
        `[effects] skipping effects for step (segment "${step.narrationSegmentId}"): ` +
          "no matching scene range on the clip.",
      );
      effectIndex += step.effects.length;
      continue;
    }
    const gate = { startSec: scene.startMs / 1000, endSec: scene.endMs / 1000 };

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
      const fragment = builder(effect, gate, region, currentLabel, nextLabel, `e${uid}`);
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
