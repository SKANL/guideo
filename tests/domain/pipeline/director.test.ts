import { describe, expect, it } from "vitest";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { applyDirectorDefaults } from "../../../src/domain/pipeline/director.js";

const script = parseScript({
  segments: [{ id: "seg-1", text: "Invite a teammate.", timing: { startMs: 0, durationMs: 1000 } }],
});

describe("applyDirectorDefaults", () => {
  it("does not add motion unless emphasis is explicitly enabled", () => {
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "click",
          selector: "#invite",
          narrationSegmentId: "seg-1",
          params: { requiresFocus: true },
          evidence: { reference: "Invite teammate", expectedPostState: "Invite dialog is open" },
        },
      ],
    });

    expect(applyDirectorDefaults(storyboard, script).steps[0]?.effects).toEqual([]);
  });

  it("focuses a meaningful click target with deterministic entry and exit timing when opted in", () => {
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "click",
          selector: "#invite",
          narrationSegmentId: "seg-1",
          params: { requiresFocus: true },
          evidence: { reference: "Invite teammate", expectedPostState: "Invite dialog is open" },
        },
      ],
    });

    const result = applyDirectorDefaults(storyboard, script, { motionEmphasisEnabled: true });

    expect(result.steps[0]?.effects).toContainEqual({
      type: "zoom-in",
      params: {
        selector: "#invite",
        semanticTarget: "Invite teammate",
        postcondition: "Invite dialog is open",
        level: 1.25,
        entryMs: 400,
        exitMs: 1000,
      },
    });
  });

  it.each(["type", "navigate", "pause"] as const)("never zooms %s actions", (action) => {
    const step =
      action === "type"
        ? { action, selector: "#email", narrationSegmentId: "seg-1" }
        : { action, narrationSegmentId: "seg-1" };
    const storyboard = parseStoryboard({ steps: [step] });

    expect(
      applyDirectorDefaults(storyboard, script, { motionEmphasisEnabled: true }).steps[0]?.effects,
    ).toEqual([]);
  });

  it("preserves authored effects and does not add a conflicting default", () => {
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "hover",
          selector: "#invite",
          narrationSegmentId: "seg-1",
          evidence: { reference: "Invite teammate" },
          effects: [{ type: "crop", params: { x: 1, y: 2, w: 3, h: 4 } }],
        },
      ],
    });

    expect(
      applyDirectorDefaults(storyboard, script, { motionEmphasisEnabled: true }).steps[0]?.effects,
    ).toEqual([{ type: "crop", params: { x: 1, y: 2, w: 3, h: 4 } }]);
  });

  it("keeps the legacy zoomDefaultsEnabled opt-in compatible without interval selection", () => {
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "hover",
          selector: "#invite",
          narrationSegmentId: "seg-1",
          evidence: { reference: "Invite teammate" },
        },
      ],
    });

    expect(
      applyDirectorDefaults(storyboard, script, { zoomDefaultsEnabled: true }).steps[0]?.effects,
    ).toEqual([]);
  });

  it("uses a timed spotlight for every semantic action and never invents a zoom without a focus cue", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "click", selector: "#invite", narrationSegmentId: "seg-1", evidence: { reference: "Invite teammate" } },
        { action: "click", selector: "#confirm", narrationSegmentId: "seg-1", evidence: { reference: "Confirm invitation" } },
      ],
    });
    const result = applyDirectorDefaults(storyboard, script, { motionEmphasisEnabled: true });
    expect(result.steps.flatMap((step) => step.effects).filter((effect) => effect.type === "crop")).toHaveLength(2);
    expect(result.steps.flatMap((step) => step.effects).filter((effect) => effect.type === "zoom-in")).toHaveLength(0);
    expect(result.steps[0]?.effects).toContainEqual({
      type: "crop",
      params: expect.objectContaining({ selector: "#invite", entryMs: 100, exitMs: 400 }),
    });
  });

  it("does not zoom a selector without Discover evidence, but retains action emphasis", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#invite", narrationSegmentId: "seg-1" }],
    });
    const effects = applyDirectorDefaults(storyboard, script, { motionEmphasisEnabled: true }).steps[0]?.effects;
    expect(effects).toContainEqual({ type: "crop", params: expect.objectContaining({ selector: "#invite" }) });
    expect(effects?.some((effect) => effect.type === "zoom-in")).toBe(false);
  });

  it("uses a stable callout rather than an arbitrary zoom when the action has no verified postcondition", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#invite", narrationSegmentId: "seg-1" }],
    });

    const effects = applyDirectorDefaults(storyboard, script, { motionEmphasisEnabled: true }).steps[0]?.effects;

    expect(effects).toContainEqual({ type: "crop", params: expect.objectContaining({ selector: "#invite" }) });
    expect(effects?.some((effect) => effect.type === "zoom-in")).toBe(false);
  });
});
