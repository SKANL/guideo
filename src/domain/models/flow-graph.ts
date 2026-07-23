import { z } from "zod";

export const FlowGraphNodeSchema = z.object({
  id: z.string().min(1),
  feature: z.string().min(1),
  useCase: z.string().min(1),
  preconditions: z.array(z.string()),
  selectors: z.record(z.string(), z.string()),
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
  return FlowGraphSchema.parse(input);
}

// ponytail: minimal in-memory query stub proving the schema is query-ready; full route-subset
// query logic (flow-graph-query.ts) lands in Phase 3 (T3.1).
export function queryNodesByFeature(graph: FlowGraph, feature: string): FlowGraphNode[] {
  return graph.nodes.filter((node) => node.feature === feature);
}
