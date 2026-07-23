import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDiscover } from "../../../src/app/commands/discover.js";
import { defaultPaths } from "../../../src/app/paths.js";
import type { FlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { Target } from "../../../src/domain/ports/target.js";

class FakeTarget implements Target {
  discoverCalls = 0;
  constructor(private readonly graph: FlowGraph) {}
  async discover(): Promise<FlowGraph> {
    this.discoverCalls += 1;
    return this.graph;
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
  it("calls Target.discover() and persists the returned FlowGraph as JSON at the CLI-owned path", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = defaultPaths(scratchDir);
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
  });

  it("overwrites a previously written flow graph on re-run (re-runnable per spec)", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-discover-test-"));
    const paths = defaultPaths(scratchDir);
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
});
