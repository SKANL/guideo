// The DIRECTOR: pure, deterministic default-effect decoration (effects-overhaul Phase C, see
// Engram architecture/guideo-effects-overhaul). Fixes "random/meaningless effects" at the root —
// rather than relying solely on the AI to sprinkle effects, the Director applies tasteful
// RULE-BASED defaults so a storyboard is coherent by construction before any AI/human curation
// touches it. Wired into `runPlan` (app/commands/plan.ts) AFTER ScriptGen produces the storyboard
// and BEFORE it's written for the REVIEW gate — the human sees (and can edit/remove) these
// defaults, never a bypass of the gate. No I/O, no randomness: same input always -> same output.
//
// One default, toggleable and skippable so nothing already authored (AI or human) is ever
// overwritten: a gentle default zoom-in on each scene's FOCAL element — its first click/hover/zoom
// step that carries a selector. Skipped entirely if the scene already has ANY effect on ANY of its
// steps (respects existing intent) or has no focal element (pure navigate/pause/type scenes).
//
// Scene-boundary transitions are NOT a Director concern anymore (per-scene-clip architecture
// Phase 1): the DIRECTOR only ever edits ONE shared/continuous clip's storyboard-step effects, so
// the transition it used to add was a single-clip `fade=in:st=T`, which renders everything BEFORE T
// black across the WHOLE video — see the SceneAssembler (ffmpeg-scene-assembler.ts), which now owns
// transitions correctly: it splits each scene into its own clip file first, so a fade LOCAL to that
// clip's own edge is always correct.
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
  // Viewport-relative pixel box (capture-config.ts's coordinate space, default 1280x720) the
  // Director's own default zoom pushes into. Framing fix: the default zoom used to target the
  // FOCAL step's selector, which for a "click a sidebar nav link" step is the sidebar link itself
  // — the zoom emphasized the sidebar, not the content the narration is about. An explicit region
  // sidesteps that entirely (no app-specific element resolution needed): it targets the main
  // content area, right of the left sidebar and below the top bar. AI/user-authored effects that
  // carry their own `selector` are untouched — only the Director's own default switches to this.
  readonly contentRegion: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

// Default box tuned for the default 1280x720 viewport (capture-config.ts): a typical left sidebar
// nav runs roughly 0-260px wide and a top bar roughly 0-64px tall, so 330,96 clears both with a
// little margin; 830x540 keeps the box comfortably inside the remaining content area (ends at
// 1160,636 — inside the 1280x720 frame) so the animated zoom's crop never reads outside the frame.
export const DEFAULT_CONTENT_REGION = { x: 330, y: 96, w: 830, h: 540 } as const;

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  zoomDefaultsEnabled: true,
  zoomLevel: 1.12,
  zoomSceneInterval: 3,
  contentRegion: DEFAULT_CONTENT_REGION,
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
        params: { ...cfg.contentRegion, level: cfg.zoomLevel },
      };
      steps[focalIndex] = withAddedEffect(step, zoom);
    }
  }

  return { ...storyboard, steps };
}
