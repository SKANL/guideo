import { describe, expect, it } from "vitest";
import { CONVERSATIONAL_NO_AI_TELLS_PROMPT } from "../../../src/adapters/script/calibration-prompt.js";
import type {
  ClaudeAgentQueryFn,
  ClaudeAgentResultLike,
} from "../../../src/adapters/script/claude-agent-script-gen.js";
import { ClaudeAgentScriptGen } from "../../../src/adapters/script/claude-agent-script-gen.js";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { FlowGraphRoutes } from "../../../src/domain/ports/script-gen.js";

const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });
const routes: FlowGraphRoutes = parseFlowGraph({
  nodes: [
    {
      id: "n1",
      feature: "invite",
      useCase: "invite teammate",
      preconditions: [],
      selectors: { inviteButton: "#invite" },
    },
  ],
  edges: [],
});

const validOutput = {
  script: {
    segments: [
      { id: "seg-1", text: "First, click invite.", timing: { startMs: 0, durationMs: 1200 } },
    ],
  },
  storyboard: {
    steps: [{ action: "click", selector: "#invite", narrationSegmentId: "seg-1" }],
  },
};

function fakeQueryFn(
  structuredOutput: unknown,
  overrides: Partial<ClaudeAgentResultLike> = {},
): { fn: ClaudeAgentQueryFn; calls: Array<Parameters<ClaudeAgentQueryFn>[0]> } {
  const calls: Array<Parameters<ClaudeAgentQueryFn>[0]> = [];
  const fn: ClaudeAgentQueryFn = (params) => {
    calls.push(params);
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        structured_output: structuredOutput,
        ...overrides,
      } as ClaudeAgentResultLike;
    })();
  };
  return { fn, calls };
}

describe("ClaudeAgentScriptGen", () => {
  // Regression (real e2e): the claude CLI's --json-schema validator rejects a draft-2020-12 meta
  // `$schema` ref ("no schema with key or ref .../draft/2020-12/schema"). The schema handed to the
  // SDK must carry no such meta reference.
  it("hands the SDK a JSON schema with no draft-meta $schema reference", async () => {
    const { fn, calls } = fakeQueryFn(validOutput);
    const scriptGen = new ClaudeAgentScriptGen(fn);

    await scriptGen.generate(brief, routes);

    const schema = calls[0]?.options?.outputFormat?.schema ?? {};
    expect("$schema" in schema).toBe(false);
    expect(JSON.stringify(schema)).not.toContain("json-schema.org/draft/2020-12");
  });

  it("builds a prompt containing the brief + route subset and returns validated script + storyboard", async () => {
    const { fn, calls } = fakeQueryFn(validOutput);
    const scriptGen = new ClaudeAgentScriptGen(fn);

    const result = await scriptGen.generate(brief, routes);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("expected a call");
    expect(call.prompt).toContain(brief.idea);
    expect(call.prompt).toContain("invite");
    expect(call.prompt).toContain("#invite");
    expect(result.script.segments[0]?.text).toBe("First, click invite.");
    expect(result.storyboard.steps[0]?.selector).toBe("#invite");
  });

  it("uses the conversational/no-AI-tells calibration prompt as the SDK systemPrompt", async () => {
    const { fn, calls } = fakeQueryFn(validOutput);
    const scriptGen = new ClaudeAgentScriptGen(fn);

    await scriptGen.generate(brief, routes);

    const call = calls[0];
    if (!call) throw new Error("expected a call");
    expect(call.options?.systemPrompt).toBe(CONVERSATIONAL_NO_AI_TELLS_PROMPT);
  });

  it("requests structured output via a json_schema outputFormat, not free-text parsing", async () => {
    const { fn, calls } = fakeQueryFn(validOutput);
    const scriptGen = new ClaudeAgentScriptGen(fn);

    await scriptGen.generate(brief, routes);

    const call = calls[0];
    if (!call) throw new Error("expected a call");
    expect(call.options?.outputFormat?.type).toBe("json_schema");
    expect(call.options?.outputFormat?.schema).toBeTruthy();
  });

  it("raises a clear validation error on malformed SDK output instead of returning silent garbage", async () => {
    const { fn } = fakeQueryFn({ script: { segments: [] }, storyboard: { steps: "not-an-array" } });
    const scriptGen = new ClaudeAgentScriptGen(fn);

    await expect(scriptGen.generate(brief, routes)).rejects.toThrow(/validation/i);
  });

  it("rejects a storyboard step whose narrationSegmentId does not resolve to a script segment", async () => {
    const { fn } = fakeQueryFn({
      script: {
        segments: [
          { id: "seg-1", text: "Click invite.", timing: { startMs: 0, durationMs: 1000 } },
        ],
      },
      storyboard: {
        steps: [{ action: "click", selector: "#invite", narrationSegmentId: "seg-does-not-exist" }],
      },
    });
    const scriptGen = new ClaudeAgentScriptGen(fn);

    await expect(scriptGen.generate(brief, routes)).rejects.toThrow(/narrationSegmentId/);
  });

  it("surfaces a clear error when the SDK reports a non-success result, instead of silently continuing", async () => {
    const { fn } = fakeQueryFn(undefined, {
      subtype: "error_during_execution",
      is_error: true,
      structured_output: undefined,
      errors: ["upstream failure"],
    });
    const scriptGen = new ClaudeAgentScriptGen(fn);

    await expect(scriptGen.generate(brief, routes)).rejects.toThrow(/upstream failure/);
  });

  it("constructs and runs against an injected fake with no ANTHROPIC_API_KEY set (no key required)", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { fn } = fakeQueryFn(validOutput);
      expect(() => new ClaudeAgentScriptGen(fn)).not.toThrow();
      const scriptGen = new ClaudeAgentScriptGen(fn);
      await expect(scriptGen.generate(brief, routes)).resolves.toBeTruthy();
    } finally {
      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });

  it("does not require ANTHROPIC_API_KEY at construction time even without an injected client", () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new ClaudeAgentScriptGen()).not.toThrow();
    } finally {
      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });

  // --- AI-proposed effects (design section B: AI proposes, human reviews at the gate) -------

  it("hands the SDK a schema whose storyboard step effects carry the effect-type vocabulary", async () => {
    const { fn, calls } = fakeQueryFn(validOutput);
    const scriptGen = new ClaudeAgentScriptGen(fn);

    await scriptGen.generate(brief, routes);

    const schema = calls[0]?.options?.outputFormat?.schema;
    expect(JSON.stringify(schema)).toContain("zoom-in");
    expect(JSON.stringify(schema)).toContain("blur-region");
  });

  it("explains the available effect types in the system prompt as human-reviewable suggestions", () => {
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT).toMatch(/zoom-in/);
    expect(CONVERSATIONAL_NO_AI_TELLS_PROMPT.toLowerCase()).toMatch(/suggest|review/);
  });

  it("validates and returns a storyboard whose steps carry AI-proposed effects", async () => {
    const outputWithEffects = {
      script: validOutput.script,
      storyboard: {
        steps: [
          {
            action: "click",
            selector: "#invite",
            narrationSegmentId: "seg-1",
            effects: [{ type: "zoom-in", params: { x: 10, y: 20 } }],
          },
        ],
      },
    };
    const { fn } = fakeQueryFn(outputWithEffects);
    const scriptGen = new ClaudeAgentScriptGen(fn);

    const result = await scriptGen.generate(brief, routes);

    expect(result.storyboard.steps[0]?.effects).toEqual([
      { type: "zoom-in", params: { x: 10, y: 20 } },
    ]);
  });

  it("passes a custom model through to the SDK query options when configured", async () => {
    const { fn, calls } = fakeQueryFn(validOutput);
    const scriptGen = new ClaudeAgentScriptGen(
      fn,
      CONVERSATIONAL_NO_AI_TELLS_PROMPT,
      "claude-opus-4-8",
    );

    await scriptGen.generate(brief, routes);

    expect(calls[0]?.options?.model).toBe("claude-opus-4-8");
  });
});
