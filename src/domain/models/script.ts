import { z } from "zod";
import type { Storyboard } from "./storyboard.js";

export const NarrationSegmentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  timing: z.object({
    startMs: z.number().nonnegative(),
    durationMs: z.number().positive(),
  }),
});
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;

export const ScriptSchema = z.object({
  segments: z.array(NarrationSegmentSchema).min(1),
});
export type Script = z.infer<typeof ScriptSchema>;

export function parseScript(input: unknown): Script {
  return ScriptSchema.parse(input);
}

// Cross-model validation: every Storyboard step's narrationSegmentId must resolve to a
// segment in the given Script. Pure, no I/O — throws with the dangling ids listed.
export function assertNarrationRefsResolve(storyboard: Storyboard, script: Script): void {
  const knownSegmentIds = new Set(script.segments.map((segment) => segment.id));
  const danglingIds = [
    ...new Set(
      storyboard.steps
        .map((step) => step.narrationSegmentId)
        .filter((narrationSegmentId) => !knownSegmentIds.has(narrationSegmentId)),
    ),
  ];
  if (danglingIds.length > 0) {
    throw new Error(
      `Storyboard references narrationSegmentId(s) not present in Script: ${danglingIds.join(", ")}`,
    );
  }
}
