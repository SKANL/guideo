import { describe, expect, it } from "vitest";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import { parseStoryboard, type Storyboard } from "../../../src/domain/models/storyboard.js";
import {
  assertStoryboardActionCoverage,
  bindStoryboardProvenance,
} from "../../../src/domain/pipeline/storyboard-provenance.js";

const routes = parseFlowGraph({
  nodes: [
    {
      id: "login",
      feature: "login",
      useCase: "sign in",
      preconditions: [],
      selectors: { username: "#user-name", submit: "#login-button" },
      locatorEvidence: { candidates: ["#login-button", "#user-name"], urlFingerprint: "url-login" },
    },
  ],
  edges: [],
});

describe("bindStoryboardProvenance", () => {
  it("fails closed when a selector-required step omits its selector", () => {
    const storyboard = {
      steps: [{ action: "click", narrationSegmentId: "seg-1", effects: [], visibility: "show" }],
    } as Storyboard;

    expect(() => bindStoryboardProvenance(storyboard, routes)).toThrow(/requires.*selector/i);
  });

  it("rejects a selector that Discover did not provide", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#invented", narrationSegmentId: "seg-1" }],
    });

    expect(() => bindStoryboardProvenance(storyboard, routes)).toThrow(/not present.*Discover/i);
  });

  it("binds deterministic locator and URL evidence for a known selector", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#login-button", narrationSegmentId: "seg-1" }],
    });

    expect(bindStoryboardProvenance(storyboard, routes).steps[0]?.evidence).toEqual({
      locatorCandidates: ["#login-button"],
      urlFingerprint: "url-login",
    });
  });
});

describe("assertStoryboardActionCoverage", () => {
  it("rejects a pause-only storyboard for an action-oriented brief with Discover selector evidence", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const brief = parseBrief({
      idea: "Show how to sign in",
      targetPlatform: "youtube",
    });

    expect(() => assertStoryboardActionCoverage(storyboard, routes, brief)).toThrow(
      /requires at least one executable action/i,
    );
  });

  it("accepts an action-oriented storyboard with an executable action", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#login-button", narrationSegmentId: "seg-1" }],
    });
    const brief = parseBrief({
      idea: "Show how to sign in",
      targetPlatform: "youtube",
    });

    expect(() => assertStoryboardActionCoverage(storyboard, routes, brief)).not.toThrow();
  });

  it("keeps explanatory briefs compatible with pause-only storyboards", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const brief = parseBrief({
      idea: "Explain the benefits of team collaboration",
      targetPlatform: "youtube",
    });

    expect(() => assertStoryboardActionCoverage(storyboard, routes, brief)).not.toThrow();
  });

  it("fails closed when an action-oriented brief has no relevant discovered routes", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const brief = parseBrief({ idea: "Show how to add a product", targetPlatform: "youtube" });

    expect(() => assertStoryboardActionCoverage(storyboard, { nodes: [], edges: [] }, brief)).toThrow(
      /no relevant discovered routes/i,
    );
  });
});
