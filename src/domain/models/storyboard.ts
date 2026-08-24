import { z } from "zod";
import { EffectSchema } from "./effect.js";

export const StepActionSchema = z.enum(["navigate", "click", "type", "hover", "zoom", "pause"]);
export type StepAction = z.infer<typeof StepActionSchema>;

export const ShotIntentSchema = z.enum(["establish", "focus", "action", "result", "hold", "reveal"]);
export type ShotIntent = z.infer<typeof ShotIntentSchema>;
export const CaptionPlacementSchema = z.enum(["lower-third", "top", "bottom-left", "bottom-right"]);
export type CaptionPlacement = z.infer<typeof CaptionPlacementSchema>;
export const FunctionalPauseKindSchema = z.enum(["typing", "loading", "confirmation", "comprehension"]);
export type FunctionalPauseKind = z.infer<typeof FunctionalPauseKindSchema>;

export const DirectorOverrideSchema = z.object({
  shotIntent: ShotIntentSchema.optional(),
  focus: z.object({ enabled: z.boolean(), target: z.string().min(1).optional() }).optional(),
  captionPlacement: CaptionPlacementSchema.optional(),
  functionalPause: z.object({ kind: FunctionalPauseKindSchema, intentional: z.boolean(), durationMs: z.number().int().nonnegative().optional() }).optional(),
});
export type DirectorOverride = z.infer<typeof DirectorOverrideSchema>;
export const StoryboardProvenanceSchema = z.object({ schema: z.string().min(1), version: z.number().int().positive(), source: z.enum(["discover", "director", "review"]), reviewedAt: z.string().datetime().optional(), reviewer: z.string().min(1).optional() });
export type StoryboardProvenance = z.infer<typeof StoryboardProvenanceSchema>;

// Actions that operate on a specific element require a selector; navigate/pause don't target one.
const SELECTOR_REQUIRED_ACTIONS: ReadonlySet<StepAction> = new Set([
  "click",
  "type",
  "hover",
  "zoom",
]);

export function isSelectorRequiredAction(action: StepAction): boolean {
  return SELECTOR_REQUIRED_ACTIONS.has(action);
}

export const StepSchema = z
  .object({
    action: StepActionSchema,
    selector: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    narrationSegmentId: z.string().min(1),
    // AI-proposed at Plan time (design doc section B); the human reviews/edits at the REVIEW gate.
    // Defaults to [] so storyboards authored before this field existed still parse unchanged.
    effects: z.array(EffectSchema).default([]),
    // Privacy/redaction (design doc section C, sub-project 5b). "private" cuts this step's scene
    // (every step sharing its narrationSegmentId) entirely from the composed output — see
    // src/domain/pipeline/privacy-cut.ts. Primary path: the user marks this at the REVIEW gate by
    // editing storyboard.json; ScriptGen may also propose it for obviously-sensitive scenes.
    // Defaults to "show" so storyboards authored before this field existed still parse unchanged.
    visibility: z.enum(["show", "private"]).default("show"),
    // Human-reviewable director controls. Optional to keep existing storyboards byte-compatible.
    director: DirectorOverrideSchema.optional(),
    evidence: z.object({
      expectedPreState: z.string().min(1).optional(),
      expectedPostState: z.string().min(1).optional(),
      reference: z.string().min(1).optional(),
      // Discovery can provide several independently observed locators. Capture resolves these
      // deterministically and refuses ambiguous targets rather than clicking an arbitrary match.
      locatorCandidates: z.array(z.string().min(1)).min(1).optional(),
      // The page URL observed during discovery. A mismatch means the reviewed target state has
      // drifted and must be re-discovered instead of being executed blindly.
      urlFingerprint: z.string().min(1).optional(),
    }).optional(),
  })
  .superRefine((step, ctx) => {
    if (isSelectorRequiredAction(step.action) && !step.selector) {
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
  provenance: StoryboardProvenanceSchema.optional(),
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
  readonly approvalProvenance?: { readonly schema: "approval"; readonly version: 2; readonly manifestSha256: string };
};
