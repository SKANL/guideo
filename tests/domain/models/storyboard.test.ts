import { describe, expect, it } from "vitest";
import { parseStoryboard, StoryboardSchema } from "../../../src/domain/models/storyboard.js";

const validStoryboard = {
  steps: [
    {
      action: "navigate",
      params: { url: "https://example.com/login" },
      narrationSegmentId: "seg-1",
    },
    { action: "click", selector: "#email", narrationSegmentId: "seg-2" },
    {
      action: "type",
      selector: "#email",
      params: { text: "user@example.com" },
      narrationSegmentId: "seg-2",
    },
    { action: "hover", selector: "#submit", narrationSegmentId: "seg-3" },
    { action: "zoom", selector: "#submit", narrationSegmentId: "seg-3" },
    { action: "pause", narrationSegmentId: "seg-4" },
  ],
};

describe("StoryboardSchema", () => {
  it("parses a valid Storyboard covering every action", () => {
    const storyboard = parseStoryboard(validStoryboard);
    expect(storyboard.steps).toHaveLength(6);
  });

  it("rejects a step with an invalid action enum value", () => {
    const invalid = {
      steps: [{ action: "scroll", selector: "#x", narrationSegmentId: "seg-1" }],
    };
    const result = StoryboardSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("action"))).toBe(true);
    }
  });

  it("rejects a click step missing a selector", () => {
    const invalid = {
      steps: [{ action: "click", narrationSegmentId: "seg-1" }],
    };
    const result = StoryboardSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("selector"))).toBe(true);
    }
  });

  it("allows a pause step without a selector", () => {
    const valid = { steps: [{ action: "pause", narrationSegmentId: "seg-1" }] };
    expect(() => parseStoryboard(valid)).not.toThrow();
  });

  it("rejects a step missing narrationSegmentId", () => {
    const invalid = { steps: [{ action: "pause" }] };
    expect(() => parseStoryboard(invalid)).toThrow();
  });

  it("defaults a step's effects to [] when omitted (existing storyboards still parse)", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    expect(storyboard.steps[0]?.effects).toEqual([]);
  });

  it("parses a step carrying AI-proposed effects", () => {
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "zoom",
          selector: "#stat",
          narrationSegmentId: "seg-1",
          effects: [{ type: "zoom-in", params: { x: 1, y: 2 } }],
        },
      ],
    });
    expect(storyboard.steps[0]?.effects).toEqual([{ type: "zoom-in", params: { x: 1, y: 2 } }]);
  });

  it("rejects a step whose effect has an unknown type", () => {
    const invalid = {
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [{ type: "spin-360" }],
        },
      ],
    };
    const result = StoryboardSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('defaults a step\'s visibility to "show" when omitted (existing storyboards still parse)', () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    expect(storyboard.steps[0]?.visibility).toBe("show");
  });

  it("parses a step explicitly marked private", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1", visibility: "private" }],
    });
    expect(storyboard.steps[0]?.visibility).toBe("private");
  });

  it("rejects a step with an invalid visibility value", () => {
    const invalid = {
      steps: [{ action: "pause", narrationSegmentId: "seg-1", visibility: "hidden" }],
    };
    const result = StoryboardSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
