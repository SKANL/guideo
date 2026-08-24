import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDiscover } from "../../../src/app/commands/discover.js";
import { projectPaths } from "../../../src/app/paths.js";
import type { ArtifactManifest, ArtifactRef } from "../../../src/domain/artifacts/manifest.js";
import { deriveCapabilityProfile } from "../../../src/domain/models/capability-profile.js";
import type { FlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { ArtifactStore } from "../../../src/domain/ports/artifact-store.js";
import type { Target } from "../../../src/domain/ports/target.js";
import type {
  BudgetRequest,
  Reservation,
  UsageActual,
  UsageLedger,
  UsageSnapshot,
} from "../../../src/domain/ports/usage-ledger.js";

class FakeTarget implements Target {
  discoverCalls = 0;
  constructor(private readonly graph: FlowGraph) {}
  async discover(): Promise<FlowGraph> {
    this.discoverCalls += 1;
    return this.graph;
  }
}

class MemoryArtifactStore implements ArtifactStore {
  readonly refs = new Map<string, ArtifactRef>();
  readonly quarantines: string[] = [];
  async lookup(key: ArtifactRef) {
    return this.refs.get(key.sha256) ?? null;
  }
  async finalize(_input: AsyncIterable<Uint8Array>, manifest: Omit<ArtifactManifest, "sha256">) {
    const ref = { ...manifest, sha256: "cached-flow" } as ArtifactRef;
    this.refs.set(ref.sha256, ref);
    return ref;
  }
  async quarantine(runId: string, reason: string) {
    this.quarantines.push(`${runId}:${reason}`);
  }
}

class CountingLedger implements UsageLedger {
  reserves = 0;
  commits: UsageActual[] = [];
  releases = 0;
  async reserve(request: BudgetRequest): Promise<Reservation> {
    this.reserves += 1;
    return { id: String(this.reserves), request };
  }
  async commit(_id: string, actual: UsageActual) {
    this.commits.push(actual);
  }
  async release(_id: string, _reason: string) {
    this.releases += 1;
  }
  async snapshot(): Promise<UsageSnapshot> {
    return { spent: 0, reserved: 0 };
  }
}

let scratchDir: string | undefined;

afterEach(async () => {
  if (scratchDir) {
    await rm(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("runDiscover", () => {
  it("derives a versioned capability profile from login evidence, semantic locators, routes, and fingerprints", () => {
    const profile = deriveCapabilityProfile(
      {
        nodes: [
          {
            id: "https://example.test/settings",
            feature: "settings",
            useCase: "settings",
            preconditions: [],
            selectors: { username: "#user", password: "#pass", save: "[data-save]" },
            locatorEvidence: {
              candidates: ["[data-save]", "text=Save"],
              urlFingerprint: "url-v1",
              buildFingerprint: "build-v1",
              stateFingerprint: "content-v1",
            },
          },
        ],
        edges: [],
      },
      { url: "url-v1", build: "build-v1", content: "content-v1" },
    );

    expect(profile.schema).toBe("target-capability-profile");
    expect(profile.version).toBe(1);
    expect(profile.loginSelectors).toMatchObject({ username: "#user", password: "#pass" });
    expect(profile.semanticLocators["https://example.test/settings"]).toEqual([
      "[data-save]",
      "text=Save",
    ]);
    expect(profile.routes).toEqual(["https://example.test/settings"]);
    expect(profile.fingerprints).toEqual({
      url: "url-v1",
      build: "build-v1",
      content: "content-v1",
    });
  });

  it("calls Target.discover() and persists the returned FlowGraph as JSON at the CLI-owned path", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const graph: FlowGraph = {
      nodes: [
        {
          id: "n1",
          feature: "invite",
          useCase: "invite a teammate",
          preconditions: [],
          selectors: { invite: "#invite" },
        },
      ],
      edges: [],
    };
    const target = new FakeTarget(graph);

    const result = await runDiscover({ target }, paths);

    expect(target.discoverCalls).toBe(1);
    expect(result.path).toBe(paths.flowGraphPath);
    const written = JSON.parse(await readFile(paths.flowGraphPath, "utf8"));
    expect(written).toEqual(graph);
    expect(JSON.parse(await readFile(paths.capabilityProfilePath, "utf8"))).toMatchObject({
      schema: "target-capability-profile",
      version: 1,
      graphSha256: expect.any(String),
    });
  });

  it("overwrites a previously written flow graph on re-run (re-runnable per spec)", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const firstGraph: FlowGraph = {
      nodes: [{ id: "n1", feature: "old", useCase: "old flow", preconditions: [], selectors: {} }],
      edges: [],
    };
    const secondGraph: FlowGraph = {
      nodes: [{ id: "n2", feature: "new", useCase: "new flow", preconditions: [], selectors: {} }],
      edges: [],
    };

    await runDiscover({ target: new FakeTarget(firstGraph) }, paths);
    await runDiscover({ target: new FakeTarget(secondGraph) }, paths);

    const written = JSON.parse(await readFile(paths.flowGraphPath, "utf8"));
    expect(written).toEqual(secondGraph);
  });

  it("reuses a finalized, valid discovered graph without reserving quota", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const graph: FlowGraph = {
      nodes: [{ id: "n1", feature: "invite", useCase: "Invite", preconditions: [], selectors: {} }],
      edges: [],
    };
    const store = new MemoryArtifactStore();
    const first = new FakeTarget(graph);
    await runDiscover({ target: first, artifactStore: store }, paths);
    const second = new FakeTarget(graph);
    const ledger = new CountingLedger();
    await runDiscover({ target: second, artifactStore: store, usageLedger: ledger }, paths);
    expect(second.discoverCalls).toBe(0);
    expect(ledger.reserves).toBe(0);
  });

  it("invalidates the cached graph and profile when a target fingerprint changes", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const graph: FlowGraph = {
      nodes: [{ id: "n1", feature: "invite", useCase: "Invite", preconditions: [], selectors: {} }],
      edges: [],
    };
    const store = new MemoryArtifactStore();
    const first: Target & { getDiscoveryFingerprint: () => Promise<{ content: string }> } = {
      discover: async () => graph,
      getDiscoveryFingerprint: async () => ({ content: "content-v1" }),
    };
    await runDiscover({ target: first, artifactStore: store }, paths);

    let calls = 0;
    const changed: Target & { getDiscoveryFingerprint: () => Promise<{ content: string }> } = {
      discover: async () => {
        calls += 1;
        return graph;
      },
      getDiscoveryFingerprint: async () => ({ content: "content-v2" }),
    };
    await runDiscover({ target: changed, artifactStore: store }, paths);

    expect(calls).toBe(1);
  });

  it("does not reuse a graph when the persisted capability profile is malformed", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const graph: FlowGraph = {
      nodes: [{ id: "n1", feature: "invite", useCase: "Invite", preconditions: [], selectors: {} }],
      edges: [],
    };
    const store = new MemoryArtifactStore();
    await runDiscover({ target: new FakeTarget(graph), artifactStore: store }, paths);
    await (await import("node:fs/promises")).writeFile(paths.capabilityProfilePath, "{}", "utf8");

    const target = new FakeTarget(graph);
    await runDiscover({ target, artifactStore: store }, paths);
    expect(target.discoverCalls).toBe(1);
  });

  it("bounds discovery retries, releases the reservation, and quarantines the failed run", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const target: Target & { calls: number } = {
      calls: 0,
      async discover() {
        this.calls += 1;
        throw new Error("network down");
      },
    };
    const store = new MemoryArtifactStore();
    const ledger = new CountingLedger();
    await expect(
      runDiscover({ target, artifactStore: store, usageLedger: ledger }, paths, { maxAttempts: 2 }),
    ).rejects.toThrow(/discovery failed after 2 attempt/);
    expect(target.calls).toBe(2);
    expect(ledger.reserves).toBe(1);
    expect(ledger.releases).toBe(1);
    expect(store.quarantines).toHaveLength(1);
  });
});
