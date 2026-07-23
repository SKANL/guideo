import type { Brief } from "../models/brief.js";
import type { FlowGraph } from "../models/flow-graph.js";
import type { Script } from "../models/script.js";
import type { Storyboard } from "../models/storyboard.js";

// The relevant route subset returned by planning's FlowGraph query (flow-graph-query.ts,
// Phase 3/tasks-doc numbering — not part of this apply pass). Structurally a FlowGraph.
export type FlowGraphRoutes = Pick<FlowGraph, "nodes" | "edges">;

// generate() returns Script + Storyboard together: per spec's `planning` requirement each
// Storyboard step's narrationSegmentId must reference a Script segment, so the two are produced
// as one unit rather than two independently-callable methods.
export interface ScriptGen {
  generate(
    brief: Brief,
    routes: FlowGraphRoutes,
  ): Promise<{ script: Script; storyboard: Storyboard }>;
}
