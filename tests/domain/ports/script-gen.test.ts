import { describe, expect, it } from "vitest";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { FlowGraphRoutes, ScriptGen } from "../../../src/domain/ports/script-gen.js";

const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });
const routes: FlowGraphRoutes = parseFlowGraph({
  nodes: [
    { id: "n1", feature: "invite", useCase: "invite teammate", preconditions: [], selectors: {} },
  ],
  edges: [],
});

class FakeScriptGen implements ScriptGen {
  async generate(_brief: typeof brief, _routes: FlowGraphRoutes) {
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
        steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
      }),
    };
  }
}

describe("ScriptGen port", () => {
  it("generates a Script + Storyboard pair from a Brief and a FlowGraph route subset", async () => {
    const scriptGen: ScriptGen = new FakeScriptGen();
    const { script, storyboard } = await scriptGen.generate(brief, routes);
    expect(script.segments[0]?.text).toBe("Let's invite a teammate.");
    expect(storyboard.steps[0]?.narrationSegmentId).toBe("seg-1");
  });
});
