import type { Brief } from "../models/brief.js";
import type { FlowGraph } from "../models/flow-graph.js";
import type { FlowGraphRoutes } from "../ports/script-gen.js";

const WORD_PATTERN = /[a-z0-9]+/g;

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD_PATTERN) ?? []);
}

// Pure in-memory query: returns only the FlowGraph node/edge subset relevant to a Brief's idea,
// matched by keyword overlap against each node's feature/useCase — no disk re-reads, satisfying
// spec's discovery-flowgraph "in-memory query" requirement. An edge is included only when both
// endpoints are in the matched node subset.
export function queryRoutes(graph: FlowGraph, brief: Brief): FlowGraphRoutes {
  const ideaWords = words(brief.idea);
  const matchedNodes = graph.nodes.filter((node) => {
    const nodeWords = words(`${node.feature} ${node.useCase}`);
    for (const word of nodeWords) {
      if (ideaWords.has(word)) return true;
    }
    return false;
  });
  const matchedIds = new Set(matchedNodes.map((node) => node.id));
  const matchedEdges = graph.edges.filter(
    (edge) => matchedIds.has(edge.from) && matchedIds.has(edge.to),
  );
  return { nodes: matchedNodes, edges: matchedEdges };
}
