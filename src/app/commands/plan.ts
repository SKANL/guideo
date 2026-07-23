import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { Brief } from "../../domain/models/brief.js";
import { type FlowGraph, parseFlowGraph } from "../../domain/models/flow-graph.js";
import type { Script } from "../../domain/models/script.js";
import type { Storyboard } from "../../domain/models/storyboard.js";
import { plan } from "../../domain/pipeline/planning.js";
import type { ScriptGen } from "../../domain/ports/script-gen.js";
import type { Target } from "../../domain/ports/target.js";
import { defaultPaths, type GuideoPaths } from "../paths.js";

// Loads the flow graph that `guideo discover` persisted. plan does NOT re-run discovery — the
// graph is discovered once (an expensive, live-browser step) and reused across many plans, per the
// "discovery = re-runnable, stored; inject routes at plan time" design bet.
function loadPersistedFlowGraph(flowGraphPath: string): FlowGraph {
  let raw: string;
  try {
    raw = readFileSync(flowGraphPath, "utf8");
  } catch {
    throw new Error(`No flow graph found at ${flowGraphPath}. Run \`guideo discover\` first.`);
  }
  return parseFlowGraph(JSON.parse(raw));
}

// plan: the REVIEW-gate hard stop. This function's parameter type only admits ScriptGen —
// RecordingEngine, VoiceGen, and PlatformProfile are not reachable through it at all, so no
// capture/voice/compose call can happen from this code path at compile time, matching
// domain/pipeline/planning.ts's own "deliberately never touches..." guarantee one layer down.
export async function runPlan(
  container: { readonly scriptGen: ScriptGen },
  brief: Brief,
  paths: GuideoPaths = defaultPaths(),
): Promise<{ script: Script; storyboard: Storyboard }> {
  const graph = loadPersistedFlowGraph(paths.flowGraphPath);
  // A cached-graph Target: plan() consumes the already-discovered graph, no live browser here.
  const cachedTarget: Target = { discover: async () => graph };
  const { script, storyboard } = await plan(cachedTarget, brief, container.scriptGen);
  await mkdir(paths.guideoDir, { recursive: true });
  await writeFile(paths.scriptPath, JSON.stringify(script, null, 2), "utf8");
  await writeFile(paths.storyboardPath, JSON.stringify(storyboard, null, 2), "utf8");
  return { script, storyboard };
}
