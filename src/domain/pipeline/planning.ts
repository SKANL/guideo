import type { Brief } from "../models/brief.js";
import type { Script } from "../models/script.js";
import type { Storyboard } from "../models/storyboard.js";
import { assertStoryboardActionCoverage } from "./storyboard-provenance.js";
import type { ScriptGen } from "../ports/script-gen.js";
import type { Target } from "../ports/target.js";
import { queryRoutes } from "./flow-graph-query.js";
import { deriveStageArtifactKey, type SceneArtifactCache } from "./scene-artifact-cache.js";

// Orchestrates discovery -> in-memory query -> generation, up to (but not past) the REVIEW gate.
// Deliberately never touches RecordingEngine/VoiceGen/PlatformProfile — those are spend, gated
// behind human approval (see render() in pipeline.ts and src/domain/review-gate.ts). The returned
// Storyboard is a plain (unapproved) Storyboard; only ReviewGate.review() can mint it further.
export async function plan(
  target: Target,
  brief: Brief,
  scriptGen: ScriptGen,
  cache?: SceneArtifactCache,
): Promise<{ script: Script; storyboard: Storyboard }> {
  const graph = await target.discover();
  const routes = queryRoutes(graph, brief);
  const key = deriveStageArtifactKey("script-gen", { brief, routes });
  const generated = await cache?.getOrLoadValue(key, isGeneratedPlan) ?? await scriptGen.generate(brief, routes);
  if (cache) await cache.putValuePersistent(key, generated);
  assertStoryboardActionCoverage(generated.storyboard, routes, brief);
  return generated;
}

function isGeneratedPlan(value: unknown): value is { script: Script; storyboard: Storyboard } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { script?: unknown; storyboard?: unknown };
  return typeof candidate.script === "object" && candidate.script !== null && Array.isArray((candidate.script as { segments?: unknown }).segments) && typeof candidate.storyboard === "object" && candidate.storyboard !== null && Array.isArray((candidate.storyboard as { steps?: unknown }).steps);
}
