import { describe, expect, it } from "vitest";
import { CONVERSATIONAL_NO_AI_TELLS_PROMPT } from "../../../src/adapters/script/calibration-prompt.js";

describe("CONVERSATIONAL_NO_AI_TELLS_PROMPT — effect-proposal guidance (effects-overhaul Phase C)", () => {
  it("tells the model to propose effects sparingly, only when they add meaning", () => {
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT).toMatch(/sparingly/i);
  });

  it("tells the model to target a selector when proposing an effect", () => {
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT).toMatch(/selector/i);
  });

  it("tells the model the Director already handles baseline default effects, so it shouldn't", () => {
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT.toLowerCase()).toContain("director");
  });

  it("requires selectors for every selector-required storyboard action and forbids invented selectors", () => {
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT).toMatch(/click.*type.*hover.*zoom/i);
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT.toLowerCase()).toContain("only use selectors");
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT.toLowerCase()).toContain("never invent");
  });

  it("requires an executable action for interactive briefs when Discover has selector evidence", () => {
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT).toMatch(/MUST include at least one executable action/i);
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT).toMatch(/pause-only storyboard/i);
  });
});
