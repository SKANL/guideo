import { describe, expect, it } from "vitest";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import {
  applyDirectorDefaults,
  DEFAULT_CONTENT_REGION,
} from "../../../src/domain/pipeline/director.js";

describe("applyDirectorDefaults — tasteful rule-based default effects (effects-overhaul Phase C)", () => {
  it("adds a gentle default zoom-in targeting the content region, not the focal step's selector", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "click", selector: "#invite-btn", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    const result = applyDirectorDefaults(storyboard);

    expect(result.steps[0]?.effects).toContainEqual({
      type: "zoom-in",
      params: { ...DEFAULT_CONTENT_REGION, level: 1.12 },
    });
    // Framing fix: the default zoom must never carry the clicked (sidebar) selector as its target.
    const zoom = result.steps[0]?.effects.find((e) => e.type === "zoom-in");
    expect(zoom?.params.selector).toBeUndefined();
  });

  it("honors a custom contentRegion in DirectorConfig", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#invite-btn", narrationSegmentId: "seg-1" }],
    });
    const customRegion = { x: 10, y: 20, w: 300, h: 200 };

    const result = applyDirectorDefaults(storyboard, { contentRegion: customRegion });

    expect(result.steps[0]?.effects).toContainEqual({
      type: "zoom-in",
      params: { ...customRegion, level: 1.12 },
    });
  });

  it("leaves an AI-proposed selector-targeted effect on another step untouched", () => {
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "click",
          selector: "#invite-btn",
          narrationSegmentId: "seg-1",
          effects: [{ type: "zoom-in", params: { selector: "#invite-btn", level: 1.3 } }],
        },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    const result = applyDirectorDefaults(storyboard);

    // Scene already has an effect, so the Director adds nothing — the AI-proposed selector-based
    // zoom is untouched, exactly as authored.
    expect(result.steps[0]?.effects).toEqual([
      { type: "zoom-in", params: { selector: "#invite-btn", level: 1.3 } },
    ]);
  });

  it("zooms only every Nth eligible scene (selective, not every scene) — tasteful + light render", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "click", selector: "#a", narrationSegmentId: "seg-1" },
        { action: "click", selector: "#b", narrationSegmentId: "seg-2" },
        { action: "click", selector: "#c", narrationSegmentId: "seg-3" },
        { action: "click", selector: "#d", narrationSegmentId: "seg-4" },
      ],
    });

    const result = applyDirectorDefaults(storyboard); // default interval 3

    const hasZoom = (i: number) =>
      (result.steps[i]?.effects ?? []).some((e) => e.type === "zoom-in");
    // Interval 3: the 1st (index 0) and 4th (index 3) eligible scenes zoom; the 2nd and 3rd do not.
    expect(hasZoom(0)).toBe(true);
    expect(hasZoom(1)).toBe(false);
    expect(hasZoom(2)).toBe(false);
    expect(hasZoom(3)).toBe(true);
  });

  it("adds no default effect to a pure navigate/pause scene with no focal element", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "navigate", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-1" },
      ],
    });

    const result = applyDirectorDefaults(storyboard);

    for (const step of result.steps) {
      expect(step.effects).toEqual([]);
    }
  });

  // Per-scene-clip architecture Phase 1: transitions are now the ASSEMBLER's structural job (each
  // scene becomes its own clip, so a LOCAL fade at that clip's own edge is correct — unlike the
  // old single-clip `fade=in:st=T`, which blacked everything before T across the whole video). The
  // Director must never add a `transition` effect itself anymore, regardless of config.
  it("never adds a transition effect at scene boundaries — the assembler owns transitions now", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "navigate", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    const result = applyDirectorDefaults(storyboard);

    for (const step of result.steps) {
      expect(step.effects.some((e) => e.type === "transition")).toBe(false);
    }
  });

  it("does not add a conflicting zoom default to a scene that already has an effect (AI-proposed or user-edited)", () => {
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "click",
          selector: "#invite-btn",
          narrationSegmentId: "seg-1",
          effects: [{ type: "crop", params: { x: 1, y: 2, w: 3, h: 4 } }],
        },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    const result = applyDirectorDefaults(storyboard);

    expect(result.steps[0]?.effects).toContainEqual({
      type: "crop",
      params: { x: 1, y: 2, w: 3, h: 4 },
    });
    expect(result.steps[0]?.effects.filter((e) => e.type === "zoom-in")).toEqual([]);
  });

  it("is deterministic — applying twice to the same input produces the same output", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "click", selector: "#a", narrationSegmentId: "seg-1" },
        { action: "hover", selector: "#b", narrationSegmentId: "seg-2" },
        { action: "pause", narrationSegmentId: "seg-3" },
      ],
    });

    const first = applyDirectorDefaults(storyboard);
    const second = applyDirectorDefaults(storyboard);

    expect(second).toEqual(first);
  });

  it("respects config toggles: zoomDefaultsEnabled=false skips the zoom default", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#invite-btn", narrationSegmentId: "seg-1" }],
    });

    const result = applyDirectorDefaults(storyboard, { zoomDefaultsEnabled: false });

    expect(result.steps[0]?.effects).toEqual([]);
  });

  it("honors a custom zoomLevel", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "click", selector: "#a", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    const result = applyDirectorDefaults(storyboard, { zoomLevel: 1.2 });

    expect(result.steps[0]?.effects).toContainEqual({
      type: "zoom-in",
      params: { ...DEFAULT_CONTENT_REGION, level: 1.2 },
    });
  });
});
