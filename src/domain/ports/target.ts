import type { FlowGraph } from "../models/flow-graph.js";

// Adapters (e.g. UrlCredsTarget, Phase 4) hold their own configuration (URL, credentials) at
// construction time; discover() itself takes no arguments so the port stays adapter-agnostic.
export interface Target {
  discover(): Promise<FlowGraph>;
}
