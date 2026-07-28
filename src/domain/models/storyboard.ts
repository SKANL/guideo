import { z } from "zod";
import { EffectSchema } from "./effect.js";

export const StepActionSchema = z.enum(["navigate", "click", "type", "hover", "zoom", "pause"]);
export type StepAction = z.infer<typeof StepActionSchema>;

// Actions that operate on a specific element require a selector; navigate/pause don't target one.
const SELECTOR_REQUIRED_ACTIONS: ReadonlySet<StepAction> = new Set([
  "click",
  "type",
  "hover",
  "zoom",
]);

export const StepSchema = z
  .object({
    action: StepActionSchema,
    selector: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    narrationSegmentId: z.string().min(1),
    // AI-proposed at Plan time (design doc section B); the human reviews/edits at the REVIEW gate.
    // Defaults to [] so storyboards authored before this field existed still parse unchanged.
    effects: z.array(EffectSchema).default([]),
  })
  .superRefine((step, ctx) => {
    if (SELECTOR_REQUIRED_ACTIONS.has(step.action) && !step.selector) {
      ctx.addIssue({
        code: "custom",
        path: ["selector"],
        message: `selector is required for action "${step.action}"`,
      });
    }
  });
export type StoryboardStep = z.infer<typeof StepSchema>;

export const StoryboardSchema = z.object({
  steps: z.array(StepSchema).min(1),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

export function parseStoryboard(input: unknown): Storyboard {
  return StoryboardSchema.parse(input);
}

// Branded type: only a value produced through the (Phase 3) ReviewGate mint may satisfy this
// type. The brand symbol is not exported, so a plain Storyboard object literal or `parseStoryboard`
// result is never structurally assignable to ApprovedStoryboard without an explicit unsafe cast.
declare const approvedStoryboardBrand: unique symbol;

export type ApprovedStoryboard = Storyboard & {
  readonly [approvedStoryboardBrand]: true;
};
