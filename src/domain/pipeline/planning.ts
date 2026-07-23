import type { Brief } from "../models/brief.js";
import type { Script } from "../models/script.js";
import type { Storyboard } from "../models/storyboard.js";
import type { ScriptGen } from "../ports/script-gen.js";
import type { Target } from "../ports/target.js";
import { queryRoutes } from "./flow-graph-query.js";

// Orchestrates discovery -> in-memory query -> generation, up to (but not past) the REVIEW gate.
// Deliberately never touches RecordingEngine/VoiceGen/PlatformProfile — those are spend, gated
// behind human approval (see render() in pipeline.ts and src/domain/review-gate.ts). The returned
// Storyboard is a plain (unapproved) Storyboard; only ReviewGate.review() can mint it further.
export async function plan(
  target: Target,
  brief: Brief,
  scriptGen: ScriptGen,
): Promise<{ script: Script; storyboard: Storyboard }> {
  const graph = await target.discover();
  const routes = queryRoutes(graph, brief);
  return scriptGen.generate(brief, routes);
}
