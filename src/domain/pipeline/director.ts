// The DIRECTOR: pure, deterministic default-effect decoration (effects-overhaul Phase C, see
// Engram architecture/guideo-effects-overhaul). Fixes "random/meaningless effects" at the root —
// rather than relying solely on the AI to sprinkle effects, the Director applies tasteful
// RULE-BASED defaults so a storyboard is coherent by construction before any AI/human curation
// touches it. Wired into `runPlan` (app/commands/plan.ts) AFTER ScriptGen produces the storyboard
// and BEFORE it's written for the REVIEW gate — the human sees (and can edit/remove) these
// defaults, never a bypass of the gate. No I/O, no randomness: same input always -> same output.
//
// Two defaults, each independently toggleable and each skippable so nothing already authored (AI
// or human) is ever overwritten:
// 1. A gentle default zoom-in on each scene's FOCAL element — its first click/hover/zoom step that
//    carries a selector. Skipped entirely if the scene already has ANY effect on ANY of its steps
//    (respects existing intent) or has no focal element (pure navigate/pause/type scenes).
// 2. A short fade `transition` at every scene BOUNDARY (not before the first scene, not after the
//    last): a fade-out on the outgoing scene's last step, a fade-in on the incoming scene's first
//    step — skipped per-step if that exact step already carries a transition (idempotent; does NOT
//    depend on the zoom-default's "already has an effect" rule, since transitions are a structural/
//    boundary concern orthogonal to a scene's content effects).
import type { Effect } from "../models/effect.js";
import type { Storyboard, StoryboardStep } from "../models/storyboard.js";

export interface DirectorConfig {
  readonly zoomDefaultsEnabled: boolean;
  readonly zoomLevel: number;
  // Zoom only every Nth eligible scene (occasional emphasis, not a zoom on EVERY scene). A zoom on
  // every scene is both visually nauseating (constant motion = not tasteful) and a very heavy
  // effects filtergraph (each animated zoom is a split+crop+scale+overlay — 7 of them made a live
  // render crawl for minutes). Interval 3 => zoom the 1st, 4th, 7th... eligible scene.
  readonly zoomSceneInterval: number;
  readonly transitionsEnabled: boolean;
  readonly transitionDurationSec: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  zoomDefaultsEnabled: true,
  zoomLevel: 1.12,
  zoomSceneInterval: 3,
  // OFF by default: the `transition` effect is a single-clip `fade` (see effect-filter-builders),
  // and ffmpeg's `fade=in:st=T` renders everything BEFORE T black — chaining one per scene boundary
  // blacked out almost the whole video (real e2e). A correct boundary dip/crossfade needs per-scene
  // clips composed with `xfade`, which this single continuous/cut clip doesn't have yet. Left
  // available (opt-in) and wired, but not auto-applied until that per-scene-clip upgrade lands.
  transitionsEnabled: false,
  transitionDurationSec: 0.5,
};

// Actions that target a specific on-screen element — a scene's focal point, if any. Matches the
// design doc's "a click/hover/zoom step with a selector" language; deliberately excludes "type"
// and "navigate" (typing into a field or navigating isn't "showing" something the way clicking,
// hovering, or an explicit zoom step is).
const FOCAL_ACTIONS: ReadonlySet<string> = new Set(["click", "hover", "zoom"]);

interface Scene {
  readonly narrationSegmentId: string;
  readonly indices: readonly number[];
}

// A "scene" is a consecutive run of storyboard steps sharing one narrationSegmentId — same
// adjacency-only grouping as WebRecordingEngine.groupIntoScenes (recording/web-recording-engine.ts)
// and privacy-cut.ts's scene concept, just tracking step INDICES here instead of step objects so
// the caller can address (and replace) specific steps in the storyboard's own step array.
function groupIntoScenes(steps: readonly StoryboardStep[]): Scene[] {
  const scenes: { narrationSegmentId: string; indices: number[] }[] = [];
  steps.forEach((step, index) => {
    const last = scenes[scenes.length - 1];
    if (last && last.narrationSegmentId === step.narrationSegmentId) {
      last.indices.push(index);
    } else {
      scenes.push({ narrationSegmentId: step.narrationSegmentId, indices: [index] });
    }
  });
  return scenes;
}

function findFocalIndex(steps: readonly StoryboardStep[], scene: Scene): number | undefined {
  return scene.indices.find((i) => {
    const step = steps[i];
    return step !== undefined && FOCAL_ACTIONS.has(step.action) && Boolean(step.selector);
  });
}

function hasAnyEffect(steps: readonly StoryboardStep[], scene: Scene): boolean {
  return scene.indices.some((i) => (steps[i]?.effects.length ?? 0) > 0);
}

function hasTransition(step: StoryboardStep): boolean {
  return step.effects.some((effect) => effect.type === "transition");
}

function withAddedEffect(step: StoryboardStep, effect: Effect): StoryboardStep {
  return { ...step, effects: [...step.effects, effect] };
}

export function applyDirectorDefaults(
  storyboard: Storyboard,
  config: Partial<DirectorConfig> = {},
): Storyboard {
  const cfg: DirectorConfig = { ...DEFAULT_DIRECTOR_CONFIG, ...config };
  const steps = [...storyboard.steps];
  const scenes = groupIntoScenes(steps);

  if (cfg.zoomDefaultsEnabled) {
    const interval = Math.max(1, Math.floor(cfg.zoomSceneInterval));
    let eligibleCount = 0;
    for (const scene of scenes) {
      if (hasAnyEffect(steps, scene)) continue;
      const focalIndex = findFocalIndex(steps, scene);
      if (focalIndex === undefined) continue;
      const step = steps[focalIndex];
      if (!step?.selector) continue;
      // Selective: only every Nth eligible scene gets a default zoom (see zoomSceneInterval).
      const shouldZoom = eligibleCount % interval === 0;
      eligibleCount += 1;
      if (!shouldZoom) continue;
      const zoom: Effect = {
        type: "zoom-in",
        params: { selector: step.selector, level: cfg.zoomLevel },
      };
      steps[focalIndex] = withAddedEffect(step, zoom);
    }
  }

  if (cfg.transitionsEnabled) {
    for (let i = 0; i < scenes.length - 1; i += 1) {
      const outgoing = scenes[i];
      const incoming = scenes[i + 1];
      if (!outgoing || !incoming) continue;

      const outIndex = outgoing.indices[outgoing.indices.length - 1];
      const outStep = outIndex !== undefined ? steps[outIndex] : undefined;
      if (outIndex !== undefined && outStep && !hasTransition(outStep)) {
        const fadeOut: Effect = {
          type: "transition",
          params: { edge: "out", durationSec: cfg.transitionDurationSec },
        };
        steps[outIndex] = withAddedEffect(outStep, fadeOut);
      }

      const inIndex = incoming.indices[0];
      const inStep = inIndex !== undefined ? steps[inIndex] : undefined;
      if (inIndex !== undefined && inStep && !hasTransition(inStep)) {
        const fadeIn: Effect = {
          type: "transition",
          params: { edge: "in", durationSec: cfg.transitionDurationSec },
        };
        steps[inIndex] = withAddedEffect(inStep, fadeIn);
      }
    }
  }

  return { ...storyboard, steps };
}
