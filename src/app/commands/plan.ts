import { mkdir, writeFile } from "node:fs/promises";
import type { Brief } from "../../domain/models/brief.js";
import type { Script } from "../../domain/models/script.js";
import type { Storyboard } from "../../domain/models/storyboard.js";
import { plan } from "../../domain/pipeline/planning.js";
import type { ScriptGen } from "../../domain/ports/script-gen.js";
import type { Target } from "../../domain/ports/target.js";
import { defaultPaths, type GuideoPaths } from "../paths.js";

// plan: the REVIEW-gate hard stop. This function's parameter type only admits Target + ScriptGen
// — RecordingEngine, VoiceGen, and PlatformProfile are not reachable through it at all, so no
// capture/voice/compose call can happen from this code path at compile time, matching
// domain/pipeline/planning.ts's own "deliberately never touches..." guarantee one layer down.
export async function runPlan(
  container: { readonly target: Target; readonly scriptGen: ScriptGen },
  brief: Brief,
  paths: GuideoPaths = defaultPaths(),
): Promise<{ script: Script; storyboard: Storyboard }> {
  const { script, storyboard } = await plan(container.target, brief, container.scriptGen);
  await mkdir(paths.guideoDir, { recursive: true });
  await writeFile(paths.scriptPath, JSON.stringify(script, null, 2), "utf8");
  await writeFile(paths.storyboardPath, JSON.stringify(storyboard, null, 2), "utf8");
  return { script, storyboard };
}
