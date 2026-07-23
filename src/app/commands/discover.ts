import { mkdir, writeFile } from "node:fs/promises";
import type { FlowGraph } from "../../domain/models/flow-graph.js";
import type { Target } from "../../domain/ports/target.js";
import { defaultPaths, type GuideoPaths } from "../paths.js";

// discover: runs Target.discover() and persists the resulting FlowGraph as CLI-owned JSON at a
// port-agnostic, CLI-controlled path. Deliberately does not rely on any adapter's own internal
// persistence (UrlCredsTarget happens to also persist to its own configured path — that is an
// adapter implementation detail; the composition root owns satisfying spec's "write the FlowGraph
// JSON to disk" requirement for every Target implementation, fake or real).
export async function runDiscover(
  container: { readonly target: Target },
  paths: GuideoPaths = defaultPaths(),
): Promise<{ graph: FlowGraph; path: string }> {
  const graph = await container.target.discover();
  await mkdir(paths.guideoDir, { recursive: true });
  await writeFile(paths.flowGraphPath, JSON.stringify(graph, null, 2), "utf8");
  return { graph, path: paths.flowGraphPath };
}
