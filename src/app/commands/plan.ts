import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { Brief } from "../../domain/models/brief.js";
import { type FlowGraph, parseFlowGraph } from "../../domain/models/flow-graph.js";
import type { Script } from "../../domain/models/script.js";
import type { Storyboard } from "../../domain/models/storyboard.js";
import { applyDirectorDefaults, type DirectorConfig } from "../../domain/pipeline/director.js";
import { plan } from "../../domain/pipeline/planning.js";
import type { ScriptGen } from "../../domain/ports/script-gen.js";
import type { Target } from "../../domain/ports/target.js";
import { type GuideoPaths, projectPaths } from "../paths.js";

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
// `directorOptions`: toggles/tunes the Director (director.ts) that decorates the AI-proposed
// storyboard with tasteful default effects (gentle focal zoom + scene-boundary transitions) before
// it's written for the REVIEW gate — `enabled: false` turns it off entirely (default ON); the rest
// merges over DEFAULT_DIRECTOR_CONFIG.
export async function runPlan(
  container: { readonly scriptGen: ScriptGen },
  brief: Brief,
  paths: GuideoPaths = projectPaths({ project: "default" }),
  directorOptions: { readonly enabled?: boolean } & Partial<DirectorConfig> = {},
): Promise<{ script: Script; storyboard: Storyboard }> {
  const graph = loadPersistedFlowGraph(paths.flowGraphPath);
  // A cached-graph Target: plan() consumes the already-discovered graph, no live browser here.
  const cachedTarget: Target = { discover: async () => graph };
  const { script, storyboard: rawStoryboard } = await plan(
    cachedTarget,
    brief,
    container.scriptGen,
  );
  const { enabled = true, ...directorConfig } = directorOptions;
  const storyboard = enabled ? applyDirectorDefaults(rawStoryboard, directorConfig) : rawStoryboard;
  await mkdir(paths.guideoDir, { recursive: true });
  await writeFile(paths.scriptPath, JSON.stringify(script, null, 2), "utf8");
  await writeFile(paths.storyboardPath, JSON.stringify(storyboard, null, 2), "utf8");
  return { script, storyboard };
}
