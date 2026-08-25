import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDiscover } from "../../../src/app/commands/discover.js";
import { projectPaths } from "../../../src/app/paths.js";
import type { ArtifactManifest, ArtifactRef } from "../../../src/domain/artifacts/manifest.js";
import { deriveCapabilityProfile } from "../../../src/domain/models/capability-profile.js";
import { parseFlowGraph, type FlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { ArtifactStore } from "../../../src/domain/ports/artifact-store.js";
import type { Target } from "../../../src/domain/ports/target.js";
import type {
  BudgetRequest,
  Reservation,
  UsageActual,
  UsageCommit,
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
  commits: UsageCommit[] = [];
  releases = 0;
  async reserve(request: BudgetRequest): Promise<Reservation> {
    this.reserves += 1;
    return { id: String(this.reserves), request };
  }
  async commit(_id: string, actual: UsageCommit) {
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
    expect(profile.version).toBe(2);
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
    expect(profile.targetSignature).toEqual(expect.any(String));
    expect(profile.evidence["https://example.test/settings"]).toMatchObject({
      label: "save",
      locatorCandidates: ["[data-save]", "text=Save"],
    });
    expect(profile.states["https://example.test/settings"]).toBe("content-v1");
    expect(profile.observationPlan).toEqual([
      { route: "https://example.test/settings", reason: "new-route" },
    ]);
  });

  it("derives byte-identical profiles and signatures regardless of provider ordering", () => {
    const base: FlowGraph = {
      nodes: [
        { id: "https://example.test/b", feature: "b", useCase: "B", preconditions: [], selectors: { save: "button" } },
        { id: "https://example.test/a", feature: "a", useCase: "A", preconditions: [], selectors: { menu: '[data-testid="menu"]' } },
      ],
      edges: [{ from: "https://example.test/a", to: "https://example.test/b", action: "click button" }],
    };
    const reordered: FlowGraph = { nodes: [...base.nodes].reverse(), edges: [...base.edges].reverse() };

    expect(deriveCapabilityProfile(base)).toEqual(deriveCapabilityProfile(reordered));
  });

  it("preserves semantic occupancy evidence and safe caption regions in a deterministic profile", () => {
    const graph = parseFlowGraph({
      nodes: [
        {
          id: "https://example.test/invite",
          feature: "invite",
          useCase: "invite a teammate",
          preconditions: [],
          selectors: { invite: '[data-testid="invite"]' },
          locatorEvidence: {
            candidates: ['[data-testid="invite"]'],
            semanticTarget: { role: "button", accessibleName: "Invite teammate", testId: "invite" },
            postcondition: { selector: "[role=dialog]", evidence: "invite dialog is visible" },
            layoutOccupancy: [{ x: 80, y: 500, w: 1040, h: 140 }],
            safeCaptionRegions: ["top", "bottom-right"],
            confidence: "high",
            evidenceRefs: ["dom:invite", "screenshot:invite"],
          },
        },
      ],
      edges: [],
    });

    const profile = deriveCapabilityProfile(graph);

    expect(profile.evidence["https://example.test/invite"]).toMatchObject({
      semanticTarget: { role: "button", accessibleName: "Invite teammate", testId: "invite" },
      postcondition: { selector: "[role=dialog]", evidence: "invite dialog is visible" },
      layoutOccupancy: [{ x: 80, y: 500, w: 1040, h: 140 }],
      safeCaptionRegions: ["bottom-right", "top"],
      confidence: "high",
      evidenceRefs: ["dom:invite", "screenshot:invite"],
    });
    expect(deriveCapabilityProfile(graph)).toEqual(profile);
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
      version: 2,
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

  it("reuses a finalized, valid discovered graph without spending quota", async () => {
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
    expect(ledger.reserves).toBe(1);
    expect(ledger.commits).toEqual([{
      unit: "usd-micros",
      amount: 0,
      cache: "hit",
      avoidedAmount: 1,
    }]);
  });

  it("records the avoided discover spend as a cache hit without consuming quota", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const graph: FlowGraph = {
      nodes: [{ id: "n1", feature: "invite", useCase: "Invite", preconditions: [], selectors: {} }],
      edges: [],
    };
    const store = new MemoryArtifactStore();
    await runDiscover({ target: new FakeTarget(graph), artifactStore: store }, paths);
    const ledger = new CountingLedger();

    await runDiscover({ target: new FakeTarget(graph), artifactStore: store, usageLedger: ledger }, paths);

    expect(ledger.reserves).toBe(1);
    expect(ledger.commits).toEqual([{
      unit: "usd-micros",
      amount: 0,
      cache: "hit",
      avoidedAmount: 1,
    }]);
  });

  it("reuses cached semantic evidence and only re-discovers after deterministic fingerprint invalidation", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const graph: FlowGraph = parseFlowGraph({
      nodes: [{
        id: "n1", feature: "invite", useCase: "Invite", preconditions: [], selectors: { invite: "button" },
        locatorEvidence: {
          candidates: ["button"],
          semanticTarget: { role: "button", accessibleName: "Invite" },
          layoutOccupancy: [{ x: 0, y: 0, w: 10, h: 10 }],
          safeCaptionRegions: ["top"], confidence: "medium", evidenceRefs: ["dom:invite"],
        },
      }],
      edges: [],
    });
    const store = new MemoryArtifactStore();
    await runDiscover({
      target: { discover: async () => graph, getDiscoveryFingerprint: async () => ({ content: "content-v1" }) },
      artifactStore: store,
    }, paths);

    let cachedDiscoverCalls = 0;
    await runDiscover({
      target: {
        discover: async () => { cachedDiscoverCalls += 1; throw new Error("LLM/page discovery must not run"); },
        getDiscoveryFingerprint: async () => ({ content: "content-v1" }),
      },
      artifactStore: store,
    }, paths);
    expect(cachedDiscoverCalls).toBe(0);

    let invalidatedDiscoverCalls = 0;
    await runDiscover({
      target: {
        discover: async () => { invalidatedDiscoverCalls += 1; return graph; },
        getDiscoveryFingerprint: async () => ({ content: "content-v2" }),
      },
      artifactStore: store,
    }, paths);
    expect(invalidatedDiscoverCalls).toBe(1);
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

  it("plans observation only for routes whose state changed after partial invalidation", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const firstGraph: FlowGraph = {
      nodes: [
        { id: "a", feature: "a", useCase: "A", preconditions: [], selectors: { open: "button" }, locatorEvidence: { candidates: ["button"], stateFingerprint: "a-1" } },
        { id: "b", feature: "b", useCase: "B", preconditions: [], selectors: { save: "[data-testid=save]" }, locatorEvidence: { candidates: ["[data-testid=save]"], stateFingerprint: "b-1" } },
      ],
      edges: [{ from: "a", to: "b", action: "click [data-testid=save]" }],
    };
    const secondGraph: FlowGraph = { ...firstGraph, nodes: [firstGraph.nodes[0]!, { ...firstGraph.nodes[1]!, locatorEvidence: { candidates: ["[data-testid=save]"], stateFingerprint: "b-2" } }] };
    const store = new MemoryArtifactStore();
    await runDiscover({ target: { discover: async () => firstGraph, getDiscoveryFingerprint: async () => ({ content: "v1" }) }, artifactStore: store }, paths);
    await runDiscover({ target: { discover: async () => secondGraph, getDiscoveryFingerprint: async () => ({ content: "v2" }) }, artifactStore: store }, paths);

    expect(JSON.parse(await readFile(paths.discoveryObservationPlanPath, "utf8"))).toMatchObject({
      targetSignature: expect.any(String),
      pages: [{ route: "b", reason: "state-changed" }],
    });
  });

  it("fails safe when a target fingerprint probe is unavailable instead of reusing an unverifiable cache", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const graph: FlowGraph = { nodes: [{ id: "n1", feature: "invite", useCase: "Invite", preconditions: [], selectors: {} }], edges: [] };
    const store = new MemoryArtifactStore();
    await runDiscover({ target: { discover: async () => graph, getDiscoveryFingerprint: async () => ({ content: "v1" }) }, artifactStore: store }, paths);
    let discoverCalls = 0;
    await runDiscover({
      target: {
        discover: async () => { discoverCalls += 1; return graph; },
        getDiscoveryFingerprint: async () => { throw new Error("probe unavailable"); },
      },
      artifactStore: store,
    }, paths);
    expect(discoverCalls).toBe(1);
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
