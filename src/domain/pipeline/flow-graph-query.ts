import type { Brief } from "../models/brief.js";
import type { FlowGraph } from "../models/flow-graph.js";
import type { FlowGraphRoutes } from "../ports/script-gen.js";

const WORD_PATTERN = /[a-z0-9]+/g;

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD_PATTERN) ?? []);
}

function matches(node: FlowGraph["nodes"][number], query: Set<string>): boolean {
  return [...words(`${node.feature} ${node.useCase}`)].some((word) => query.has(word));
}

function sequencePosition(node: FlowGraph["nodes"][number], stages: readonly Set<string>[]): number | null {
  for (let index = 0; index < stages.length; index += 1) {
    if (matches(node, stages[index]!)) return index;
  }
  return null;
}

// Pure in-memory query: returns only the FlowGraph node/edge subset relevant to a Brief's idea,
// matched by keyword overlap against each node's feature/useCase — no disk re-reads, satisfying
// spec's discovery-flowgraph "in-memory query" requirement. An edge is included only when both
// endpoints are in the matched node subset.
export function queryRoutes(graph: FlowGraph, brief: Brief): FlowGraphRoutes {
  const ideaWords = words(brief.idea);
  const matchedNodes = graph.nodes.filter((node) => matches(node, ideaWords));
  const matchedIds = new Set(matchedNodes.map((node) => node.id));
  const stages = brief.idea.split(/\bthen\b/i).map(words).filter((stage) => stage.size > 0);
  const positions = new Map(matchedNodes.map((node) => [node.id, sequencePosition(node, stages)]));
  const matchedEdges = graph.edges.filter((edge) => {
    if (!matchedIds.has(edge.from) || !matchedIds.has(edge.to)) return false;
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    return from === null || from === undefined || to === null || to === undefined || from <= to;
  });
  return { nodes: matchedNodes, edges: matchedEdges };
}
