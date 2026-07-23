import { describe, expect, it } from "vitest";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { Target } from "../../../src/domain/ports/target.js";

const fakeGraph = parseFlowGraph({
  nodes: [{ id: "n1", feature: "login", useCase: "sign in", preconditions: [], selectors: {} }],
  edges: [],
});

class FakeTarget implements Target {
  async discover() {
    return fakeGraph;
  }
}

describe("Target port", () => {
  it("is satisfied by a fake discover() that resolves a FlowGraph", async () => {
    const target: Target = new FakeTarget();
    const graph = await target.discover();
    expect(graph.nodes).toHaveLength(1);
  });
});
