import { describe, expect, it } from "vitest";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { plan } from "../../../src/domain/pipeline/planning.js";
import { SceneArtifactCache } from "../../../src/domain/pipeline/scene-artifact-cache.js";
import type { FlowGraphRoutes, ScriptGen } from "../../../src/domain/ports/script-gen.js";
import type { Target } from "../../../src/domain/ports/target.js";

const graph = parseFlowGraph({
  nodes: [
    {
      id: "n1",
      feature: "invite",
      useCase: "invite a teammate",
      preconditions: [],
      selectors: { invite: "#invite" },
      locatorEvidence: { candidates: ["#invite"] },
    },
  ],
  edges: [],
});

class FakeTarget implements Target {
  discoverCalls = 0;
  async discover() {
    this.discoverCalls += 1;
    return graph;
  }
}

class FakeScriptGen implements ScriptGen {
  receivedRoutes: FlowGraphRoutes[] = [];
  async generate(_brief: unknown, routes: FlowGraphRoutes) {
    this.receivedRoutes.push(routes);
    return {
      script: parseScript({
        segments: [
          {
            id: "seg-1",
            text: "Let's invite a teammate.",
            timing: { startMs: 0, durationMs: 1500 },
          },
        ],
      }),
      storyboard: parseStoryboard({
        steps: [{ action: "click", selector: "#invite", narrationSegmentId: "seg-1" }],
      }),
    };
  }
}

describe("plan", () => {
  it("orchestrates discover -> query -> generate and returns an unapproved Script + Storyboard", async () => {
    const target = new FakeTarget();
    const scriptGen = new FakeScriptGen();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const result = await plan(target, brief, scriptGen);

    expect(target.discoverCalls).toBe(1);
    expect(scriptGen.receivedRoutes[0]?.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(result.script.segments[0]?.text).toBe("Let's invite a teammate.");
    expect(result.storyboard.steps[0]?.narrationSegmentId).toBe("seg-1");
  });

  it("reuses an exact ScriptGen result without a second generation call", async () => {
    const target = new FakeTarget();
    const scriptGen = new FakeScriptGen();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });
    const cache = new SceneArtifactCache();

    await plan(target, brief, scriptGen, cache);
    await plan(target, brief, scriptGen, cache);

    expect(scriptGen.receivedRoutes).toHaveLength(1);
    expect(target.discoverCalls).toBe(2);
  });
});
