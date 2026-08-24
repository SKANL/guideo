import { describe, expect, it } from "vitest";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import { parseStoryboard, type Storyboard } from "../../../src/domain/models/storyboard.js";
import { bindStoryboardProvenance } from "../../../src/domain/pipeline/storyboard-provenance.js";

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
      locatorCandidates: ["#login-button", "#user-name"],
      urlFingerprint: "url-login",
    });
  });
});
