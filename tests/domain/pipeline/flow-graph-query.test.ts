import { describe, expect, it } from "vitest";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import { queryRoutes } from "../../../src/domain/pipeline/flow-graph-query.js";

const graph = parseFlowGraph({
  nodes: [
    { id: "n1", feature: "login", useCase: "sign in", preconditions: [], selectors: {} },
    {
      id: "n2",
      feature: "invite",
      useCase: "invite a teammate",
      preconditions: [],
      selectors: {},
    },
  ],
  edges: [
    { from: "n1", to: "n2", action: "click" },
    { from: "n2", to: "n1", action: "click" },
  ],
});

describe("queryRoutes", () => {
  it("returns only the node/edge subset relevant to the brief's idea", () => {
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });
    const routes = queryRoutes(graph, brief);
    expect(routes.nodes.map((node) => node.id)).toEqual(["n2"]);
    expect(routes.edges).toEqual([]);
  });

  it("includes an edge only when both endpoints are in the matched subset", () => {
    const brief = parseBrief({
      idea: "Show login then invite a teammate",
      targetPlatform: "youtube",
    });
    const routes = queryRoutes(graph, brief);
    expect(routes.nodes.map((node) => node.id).sort()).toEqual(["n1", "n2"]);
    expect(routes.edges).toHaveLength(2);
  });

  it("returns an empty subset when nothing matches", () => {
    const brief = parseBrief({ idea: "Completely unrelated topic", targetPlatform: "youtube" });
    const routes = queryRoutes(graph, brief);
    expect(routes.nodes).toEqual([]);
    expect(routes.edges).toEqual([]);
  });
});
