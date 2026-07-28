// Pure: maps an ApprovedStoryboard's per-step AI-proposed effects onto their step's scene time
// range (matched via narrationSegmentId -> clip.scenes[*]) and threads them into ONE
// filter_complex chain. No I/O, no process spawning — see ffmpeg-effects.ts for the adapter that
// actually runs this graph through ffmpeg.
import type { RawClip } from "../../domain/models/media.js";
import type { ApprovedStoryboard } from "../../domain/models/storyboard.js";
import { filterBuilderRegistry } from "./effect-filter-builders.js";

export interface EffectsGraph {
  readonly filterComplex: string;
  readonly outputLabel: string;
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
      continue;
    }
    const gate = { startSec: scene.startMs / 1000, endSec: scene.endMs / 1000 };

    for (const effect of step.effects) {
      const builder = filterBuilderRegistry[effect.type];
      if (!builder) {
        console.warn(`[effects] skipping unknown effect type "${effect.type}".`);
        continue;
      }
      uid += 1;
      const nextLabel = `[v${uid}]`;
      const fragment = builder(effect, gate, currentLabel, nextLabel, `e${uid}`);
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
