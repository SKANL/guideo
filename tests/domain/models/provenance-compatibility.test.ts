import { describe, expect, it } from "vitest";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { MediaProbe } from "../../../src/domain/ports/media-probe.js";

describe("provenance-compatible models", () => {
  it("keeps legacy graph and storyboard JSON readable while defaulting new evidence fields", () => {
    const graph = parseFlowGraph({ nodes: [{ id: "one", feature: "f", useCase: "u", preconditions: [], selectors: {} }], edges: [] });
    const storyboard = parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "one" }] });
    expect(graph.nodes[0]?.locatorEvidence).toBeUndefined();
    expect(storyboard.steps[0]?.evidence).toBeUndefined();
  });

  it("exposes the media probe as a dedicated domain seam", () => {
    const probe: MediaProbe = { probe: async () => ({ durationMs: 1, hasAudio: false, hasVideo: true }) };
    expect(probe).toBeDefined();
  });
});
