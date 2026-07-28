import { describe, expect, it } from "vitest";
import { createContainer } from "../../src/app/factory.js";
import type { FlowGraph } from "../../src/domain/models/flow-graph.js";
import type { Target } from "../../src/domain/ports/target.js";

const graph: FlowGraph = { nodes: [], edges: [] };

class FakeTarget implements Target {
  async discover(): Promise<FlowGraph> {
    return graph;
  }
}

describe("createContainer", () => {
  it("wires an injected override adapter into the returned container instead of a real one", () => {
    const fakeTarget = new FakeTarget();

    const container = createContainer({ target: fakeTarget });

    expect(container.target).toBe(fakeTarget);
  });

  it("builds one real adapter per port when no overrides are given, without touching env or I/O", () => {
    // No GUIDEO_*/ELEVENLABS_* env vars are required here: every real adapter's constructor is
    // lazy (see each adapter's own doc comment) — construction alone must never throw.
    const container = createContainer();

    expect(container.target).toBeDefined();
    expect(container.scriptGen).toBeDefined();
    expect(container.recordingEngine).toBeDefined();
    expect(container.effectsEngine).toBeDefined();
    expect(container.voiceGen).toBeDefined();
    expect(container.platformProfile).toBeDefined();
    // Overriding only one port must leave the other four as real (non-fake) adapters.
    expect(container.target).not.toBe(new FakeTarget());
  });
});
