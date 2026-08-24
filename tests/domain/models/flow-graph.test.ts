import { describe, expect, it } from "vitest";
import {
  FlowGraphSchema,
  normalizeFlowGraph,
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

describe("FlowGraph evidence normalization", () => {
  it("creates stable, deduplicated locator evidence while accepting legacy graphs", () => {
    const legacy = {
      nodes: [{ id: "https://app.test/invite", feature: "invite", useCase: "Invite", preconditions: ["authenticated"], selectors: { first: "#invite", second: "#invite", edit: "[data-testid=invite]" } }],
      edges: [],
    };

    const normalized = normalizeFlowGraph(legacy);
    const node = normalized.nodes[0];
    expect(node?.locatorEvidence?.candidates).toEqual(["#invite", "[data-testid=invite]"]);
    expect(node?.locatorEvidence?.urlFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(node?.locatorEvidence?.buildFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(parseFlowGraph(legacy)).toEqual(normalized);
  });

  it("normalizes equivalent evidence deterministically without duplicating edges", () => {
    const input = {
      nodes: [{ id: "b", feature: "b", useCase: "B", preconditions: [], selectors: { z: "#z", a: "#a" }, locatorEvidence: { candidates: ["#z", "#a", "#z"] } }, { id: "a", feature: "a", useCase: "A", preconditions: [], selectors: {} }],
      edges: [{ from: "a", to: "b", action: "go" }, { from: "a", to: "b", action: "go" }],
    };
    const normalized = normalizeFlowGraph(input);
    expect(normalized.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(normalized.nodes[1]?.locatorEvidence?.candidates).toEqual(["#a", "#z"]);
    expect(normalized.edges).toEqual([{ from: "a", to: "b", action: "go" }]);
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
