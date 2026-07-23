import { describe, expect, it } from "vitest";
import {
  FlowGraphSchema,
  parseFlowGraph,
  queryNodesByFeature,
} from "../../../src/domain/models/flow-graph.js";

const validGraph = {
  nodes: [
    {
      id: "n1",
      feature: "login",
      useCase: "authenticate user",
      preconditions: [],
      selectors: { emailInput: "#email", submit: "button[type=submit]" },
    },
    {
      id: "n2",
      feature: "dashboard",
      useCase: "view dashboard",
      preconditions: ["authenticated"],
      selectors: { header: "#dashboard-header" },
    },
  ],
  edges: [{ from: "n1", to: "n2", action: "submit login form" }],
};

describe("FlowGraphSchema", () => {
  it("parses a valid FlowGraph", () => {
    const graph = parseFlowGraph(validGraph);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.action).toBe("submit login form");
  });

  it("rejects a node missing required fields", () => {
    const invalid = {
      nodes: [{ id: "n1", feature: "login" }],
      edges: [],
    };
    expect(() => parseFlowGraph(invalid)).toThrow();
  });

  it("rejects an edge missing the action field", () => {
    const invalid = {
      nodes: validGraph.nodes,
      edges: [{ from: "n1", to: "n2" }],
    };
    const result = FlowGraphSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("action"))).toBe(true);
    }
  });

  it("rejects non-array nodes", () => {
    expect(() => parseFlowGraph({ nodes: "not-an-array", edges: [] })).toThrow();
  });
});

describe("queryNodesByFeature", () => {
  it("returns only nodes matching the requested feature", () => {
    const graph = parseFlowGraph(validGraph);
    const result = queryNodesByFeature(graph, "login");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("n1");
  });

  it("returns an empty array when no node matches", () => {
    const graph = parseFlowGraph(validGraph);
    expect(queryNodesByFeature(graph, "nonexistent")).toEqual([]);
  });
});
