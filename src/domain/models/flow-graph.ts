import { z } from "zod";
import { sha256 } from "../artifacts/canonical.js";

const LocatorEvidenceSchema = z.object({
  candidates: z.array(z.string().min(1)).default([]),
  urlFingerprint: z.string().min(1).optional(),
  buildFingerprint: z.string().min(1).optional(),
  stateFingerprint: z.string().min(1).optional(),
});

export const FlowGraphNodeSchema = z.object({
  id: z.string().min(1),
  feature: z.string().min(1),
  useCase: z.string().min(1),
  preconditions: z.array(z.string()),
  selectors: z.record(z.string(), z.string()),
  locatorEvidence: LocatorEvidenceSchema.optional(),
});
export type FlowGraphNode = z.infer<typeof FlowGraphNodeSchema>;

export const FlowGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  action: z.string().min(1),
});
export type FlowGraphEdge = z.infer<typeof FlowGraphEdgeSchema>;

export const FlowGraphSchema = z.object({
  nodes: z.array(FlowGraphNodeSchema),
  edges: z.array(FlowGraphEdgeSchema),
});
export type FlowGraph = z.infer<typeof FlowGraphSchema>;

export function parseFlowGraph(input: unknown): FlowGraph {
  return normalizeParsedFlowGraph(FlowGraphSchema.parse(input));
}

// Discovery providers do not agree on selector order or whether they repeat a locator under
// several semantic names. Normalize once at the domain boundary so persisted graphs, cache keys,
// and later capture evidence all describe the same target state.
export function normalizeFlowGraph(input: unknown): FlowGraph {
  return normalizeParsedFlowGraph(FlowGraphSchema.parse(input));
}

function normalizeParsedFlowGraph(graph: FlowGraph): FlowGraph {
  const nodes = graph.nodes
    .map((node) => {
      const selectors = Object.fromEntries(
        Object.entries(node.selectors).sort(([left], [right]) => left.localeCompare(right)),
      );
      const suppliedEvidence = node.locatorEvidence;
      const candidates = [...new Set([
        ...(suppliedEvidence?.candidates ?? []),
        ...Object.values(selectors),
      ])].sort(compareStableStrings);
      const locatorEvidence = candidates.length === 0 && suppliedEvidence === undefined
        ? undefined
        : {
            candidates,
            urlFingerprint: suppliedEvidence?.urlFingerprint ?? sha256({ url: node.id }),
            buildFingerprint: suppliedEvidence?.buildFingerprint ?? sha256({ selectors }),
            ...(suppliedEvidence?.stateFingerprint === undefined
              ? {}
              : { stateFingerprint: suppliedEvidence.stateFingerprint }),
          };
      return { ...node, selectors, ...(locatorEvidence === undefined ? {} : { locatorEvidence }) };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = [...new Map(
    graph.edges
      .map((edge) => [
        `${edge.from}\u0000${edge.to}\u0000${edge.action}`,
        edge,
      ] as const)
      .sort(([left], [right]) => compareStableStrings(left, right)),
  ).values()];
  return { nodes, edges };
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ponytail: minimal in-memory query stub proving the schema is query-ready; full route-subset
// query logic (flow-graph-query.ts) lands in Phase 3 (T3.1).
export function queryNodesByFeature(graph: FlowGraph, feature: string): FlowGraphNode[] {
  return graph.nodes.filter((node) => node.feature === feature);
}
