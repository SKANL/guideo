import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalJson, sha256 } from "../../domain/artifacts/canonical.js";
import { artifactManifest, type ArtifactRef } from "../../domain/artifacts/manifest.js";
import { normalizeFlowGraph, type FlowGraph } from "../../domain/models/flow-graph.js";
import type { ArtifactStore } from "../../domain/ports/artifact-store.js";
import type { Target } from "../../domain/ports/target.js";
import type { UsageLedger } from "../../domain/ports/usage-ledger.js";
import { type GuideoPaths, projectPaths } from "../paths.js";

const DISCOVERY_SCHEMA = "flow-graph";
const DISCOVERY_VERSION = 1;

interface FlowGraphCacheRecord {
  readonly graphSha256: string;
  readonly ref: ArtifactRef;
}

export interface DiscoverOptions {
  readonly maxAttempts?: number;
}

// discover: runs Target.discover() and persists the resulting FlowGraph as CLI-owned JSON at a
// port-agnostic, CLI-controlled path. Deliberately does not rely on any adapter's own internal
// persistence (UrlCredsTarget happens to also persist to its own configured path — that is an
// adapter implementation detail; the composition root owns satisfying spec's "write the FlowGraph
// JSON to disk" requirement for every Target implementation, fake or real).
export async function runDiscover(
  container: { readonly target: Target; readonly artifactStore?: ArtifactStore; readonly usageLedger?: UsageLedger },
  paths: GuideoPaths = projectPaths({ project: "default" }),
  options: DiscoverOptions = {},
): Promise<{ graph: FlowGraph; path: string }> {
  const cached = await loadFinalizedCache(container.artifactStore, paths);
  if (cached) return { graph: cached, path: paths.flowGraphPath };

  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  const reservation = container.usageLedger
    ? await container.usageLedger.reserve({ operation: "discover", estimated: 1 })
    : undefined;
  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const graph = await container.target.discover();
        await persistDiscoveredGraph(container.artifactStore, paths, graph);
        if (reservation) await container.usageLedger!.commit(reservation.id, { cost: 1, cached: false });
        return { graph, path: paths.flowGraphPath };
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts || !isTransientDiscoveryError(error)) break;
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    await container.artifactStore?.quarantine(`discover-${Date.now()}`, reason);
    throw new Error(`discovery failed after ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}: ${reason}`);
  } catch (error) {
    if (reservation) {
      await container.usageLedger!.release(
        reservation.id,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
}

async function loadFinalizedCache(store: ArtifactStore | undefined, paths: GuideoPaths): Promise<FlowGraph | null> {
  if (!store) return null;
  try {
    const [rawGraph, rawCache] = await Promise.all([
      readFile(paths.flowGraphPath, "utf8"),
      readFile(paths.flowGraphCachePath, "utf8"),
    ]);
    const graph = normalizeFlowGraph(JSON.parse(rawGraph));
    const cache = JSON.parse(rawCache) as FlowGraphCacheRecord;
    if (cache.graphSha256 !== sha256(graph)) return null;
    return await store.lookup(cache.ref) ? graph : null;
  } catch {
    return null;
  }
}

async function persistDiscoveredGraph(store: ArtifactStore | undefined, paths: GuideoPaths, graph: FlowGraph): Promise<void> {
  await mkdir(paths.guideoDir, { recursive: true });
  // Keep the existing CLI persistence contract byte-compatible for legacy consumers. The cache
  // alone uses normalized bytes, so provider ordering cannot influence cache identity.
  await writeFile(paths.flowGraphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  if (!store) return;
  const normalizedGraph = normalizeFlowGraph(graph);
  const serializedGraph = canonicalJson(normalizedGraph);
  const graphSha256 = sha256(normalizedGraph);
  const manifest = artifactManifest(DISCOVERY_SCHEMA, DISCOVERY_VERSION, { graph: graphSha256 });
  const ref = await store.finalize(bytesOf(serializedGraph), manifest);
  await writeFile(paths.flowGraphCachePath, `${canonicalJson({ graphSha256, ref })}\n`, "utf8");
}

async function* bytesOf(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value);
}

function isTransientDiscoveryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /network|timeout|temporar|econn|enotfound|rate limit/i.test(message);
}
