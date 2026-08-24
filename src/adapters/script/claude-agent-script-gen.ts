// ClaudeAgentScriptGen — ScriptGen adapter, narration Script + Storyboard generation via the
// Claude Agent SDK (@anthropic-ai/claude-agent-sdk).
//
// AUTH: this adapter never reads or requires ANTHROPIC_API_KEY. The default `queryFn` is the
// real SDK's `query()`, which spawns the local `claude` CLI subprocess. When no `options.env` is
// passed to `query()` (this adapter never passes one), the subprocess inherits `process.env` as-is
// and authenticates the same way the interactive `claude` CLI does — via the logged-in Claude Code
// session on the user's MAX subscription. A paid ANTHROPIC_API_KEY is only used if one already
// happens to be present in the environment; this adapter neither sets nor checks for it. The real
// subscription-auth path is exercised in the Phase 6 e2e slice, not here — unit tests below inject
// a fake `queryFn` so `npm test` never spawns the CLI or touches the network.
//
// STRUCTURED OUTPUT: prefers the SDK's `outputFormat: {type:'json_schema', schema}` (derived from
// the Phase-2 Script/Storyboard zod schemas via `z.toJSONSchema`) over free-text parsing, so the
// model returns `structured_output` directly on the final result message instead of narration text
// that would need regex/markdown-fence extraction.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Brief } from "../../domain/models/brief.js";
import { assertNarrationRefsResolve, ScriptSchema } from "../../domain/models/script.js";
import { StoryboardSchema } from "../../domain/models/storyboard.js";
import type { FlowGraphRoutes, ScriptGen } from "../../domain/ports/script-gen.js";
import type { UsageResult } from "../../domain/ports/usage-ledger.js";
import { CONVERSATIONAL_NO_AI_TELLS_PROMPT } from "./calibration-prompt.js";

const OutputSchema = z.object({ script: ScriptSchema, storyboard: StoryboardSchema });

// The claude CLI's `--json-schema` validator can't resolve zod 4's default draft-2020-12 meta
// `$schema` URL ("no schema with key or ref .../draft/2020-12/schema"). Emit draft-7 (widely
// supported) and strip the `$schema` meta reference so the CLI validates against its own default.
function toClaudeJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function addProviderSelectorRequirements(schema: Record<string, unknown>): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    const properties = object.properties;
    const next = Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, visit(entry)]));
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      const stepProperties = properties as Record<string, unknown>;
      if ("action" in stepProperties && "selector" in stepProperties) {
        next.allOf = [
          ...(Array.isArray(next.allOf) ? next.allOf : []),
          {
            if: {
              properties: { action: { enum: ["click", "type", "hover", "zoom"] } },
              required: ["action"],
            },
            then: { required: ["selector"] },
          },
        ];
      }
    }
    return next;
  };
  return visit(schema) as Record<string, unknown>;
}

const OUTPUT_JSON_SCHEMA: Record<string, unknown> = addProviderSelectorRequirements(
  toClaudeJsonSchema(OutputSchema),
);

// Narrow structural subset of the Claude Agent SDK's query()/SDKMessage surface — only the fields
// this adapter reads off the terminal `type: "result"` message. The real SDK's `query` function
// satisfies this structurally (every SDKMessage union member carries a `type` string and none of
// the fields below are required by any other member), so it can be used directly as the default
// `queryFn` with zero casts; unit tests inject a plain fake async-generator function instead — no
// SDK-shaped mock, no CLI subprocess, no network.
export interface ClaudeAgentResultLike {
  readonly type: string;
  readonly subtype?: string;
  readonly is_error?: boolean;
  readonly result?: string;
  readonly structured_output?: unknown;
  readonly errors?: string[];
  readonly usage?: unknown;
}

export interface ClaudeAgentQueryOptions {
  readonly systemPrompt?: string;
  readonly outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
  readonly model?: string;
}

export type ClaudeAgentQueryFn = (params: {
  prompt: string;
  options?: ClaudeAgentQueryOptions;
}) => AsyncIterable<ClaudeAgentResultLike>;
export interface ClaudeUsagePricing { readonly inputTokenCostMicros: number; readonly outputTokenCostMicros: number; }
function tokenUsage(value: unknown): { inputTokens: number; outputTokens: number } | undefined { if (!value || typeof value !== "object") return undefined; const usage = value as { input_tokens?: unknown; output_tokens?: unknown }; return typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number" ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : undefined; }

function buildPrompt(brief: Brief, routes: FlowGraphRoutes): string {
  return [
    `Brief: idea="${brief.idea}", targetPlatform="${brief.targetPlatform}"`,
    "Relevant flow-graph subset (JSON) — only use selectors/routes from here:",
    JSON.stringify(routes, null, 2),
  ].join("\n\n");
}

export class ClaudeAgentScriptGen implements ScriptGen {
  private readonly queryFn: ClaudeAgentQueryFn;
  private readonly systemPrompt: string;
  private readonly model: string | undefined;
  private readonly pricing: ClaudeUsagePricing;

  constructor(
    queryFn: ClaudeAgentQueryFn = query,
    systemPrompt: string = CONVERSATIONAL_NO_AI_TELLS_PROMPT,
    model?: string,
    pricing: ClaudeUsagePricing = { inputTokenCostMicros: 0, outputTokenCostMicros: 0 },
  ) {
    this.queryFn = queryFn;
    this.systemPrompt = systemPrompt;
    this.model = model;
    this.pricing = pricing;
  }

  async generate(
    brief: Brief,
    routes: FlowGraphRoutes,
  ): Promise<{
    script: z.infer<typeof ScriptSchema>;
    storyboard: z.infer<typeof StoryboardSchema>;
  }> {
    return (await this.generateWithUsageInternal(brief, routes)).result;
  }

  async generateWithUsage(
    brief: Brief,
    routes: FlowGraphRoutes,
  ): Promise<{ result: { script: z.infer<typeof ScriptSchema>; storyboard: z.infer<typeof StoryboardSchema> }; usage: UsageResult }> {
    if (!Number.isSafeInteger(this.pricing.inputTokenCostMicros) || !Number.isSafeInteger(this.pricing.outputTokenCostMicros) || this.pricing.inputTokenCostMicros < 0 || this.pricing.outputTokenCostMicros < 0 || (this.pricing.inputTokenCostMicros === 0 && this.pricing.outputTokenCostMicros === 0)) {
      throw new Error("Claude provider-cost accounting requires configured token pricing");
    }
    const generated = await this.generateWithUsageInternal(brief, routes);
    if (!generated.usage) throw new Error("Claude Agent SDK result carried no token usage");
    return { result: generated.result, usage: generated.usage };
  }

  private async generateWithUsageInternal(
    brief: Brief,
    routes: FlowGraphRoutes,
  ): Promise<{ result: { script: z.infer<typeof ScriptSchema>; storyboard: z.infer<typeof StoryboardSchema> }; usage?: UsageResult }> {
    const prompt = buildPrompt(brief, routes);
    const options: ClaudeAgentQueryOptions = {
      systemPrompt: this.systemPrompt,
      outputFormat: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA },
      ...(this.model !== undefined ? { model: this.model } : {}),
    };

    let structuredOutput: unknown;
    let sawResult = false;
    let providerUsage: unknown;
    for await (const message of this.queryFn({ prompt, options })) {
      if (message.type !== "result") continue;
      sawResult = true;
      if (message.subtype !== "success" || message.is_error) {
        const detail = (message.errors ?? []).join("; ") || message.result || "no details";
        throw new Error(
          `Claude Agent SDK script generation failed (subtype=${message.subtype ?? "unknown"}): ${detail}`,
        );
      }
      structuredOutput = message.structured_output;
      providerUsage = message.usage;
    }

    if (!sawResult) {
      throw new Error("Claude Agent SDK query produced no result message");
    }
    if (structuredOutput === undefined) {
      throw new Error("Claude Agent SDK result carried no structured_output");
    }

    const parsed = OutputSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      throw new Error(`Claude Agent SDK output failed schema validation: ${parsed.error.message}`);
    }

    const { script, storyboard } = parsed.data;
    assertNarrationRefsResolve(storyboard, script);

    const measured = tokenUsage(providerUsage);
    const usage = measured === undefined ? undefined : {
      unit: "usd-micros" as const,
      amount: measured.inputTokens * this.pricing.inputTokenCostMicros + measured.outputTokens * this.pricing.outputTokenCostMicros,
      cache: "miss" as const,
      provider: "anthropic",
      ...(this.model === undefined ? {} : { model: this.model }),
      inputTokens: measured.inputTokens,
      outputTokens: measured.outputTokens,
    };
    return { result: { script, storyboard }, ...(usage === undefined ? {} : { usage }) };
  }
}
