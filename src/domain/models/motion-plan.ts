import { z } from "zod";

// Legacy names remain parseable; new plans describe an explicit visual purpose.
export const MotionBeatKindSchema = z.enum(["setup", "reaction", "establish", "focus", "action", "result", "hold", "reveal"]);
export type MotionBeatKind = z.infer<typeof MotionBeatKindSchema>;
export const MotionIntentSchema = z.enum(["coverage", "attention", "reframe", "establish", "focus", "action", "result", "hold", "reveal"]);
export type MotionIntent = z.infer<typeof MotionIntentSchema>;
export const CaptionSafeRegionSchema = z.enum(["lower-third", "top", "bottom-left", "bottom-right"]);
export type CaptionSafeRegion = z.infer<typeof CaptionSafeRegionSchema>;
export const MotionTargetSchema = z.object({ selector: z.string().min(1), evidence: z.string().min(1) });
export type MotionTarget = z.infer<typeof MotionTargetSchema>;
export const MotionPostconditionSchema = z.object({ selector: z.string().min(1).optional(), evidence: z.string().min(1) });
export type MotionPostcondition = z.infer<typeof MotionPostconditionSchema>;
export const MotionBeatSchema = z.object({
  kind: MotionBeatKindSchema, narrationSegmentId: z.string().min(1), stepIndex: z.number().int().nonnegative(), startMs: z.number().nonnegative(), durationMs: z.number().nonnegative(),
  target: MotionTargetSchema.optional(), postcondition: MotionPostconditionSchema.optional(), intent: MotionIntentSchema.optional(), rationale: z.string().min(1).optional(), confidence: z.enum(["low", "medium", "high"]).optional(), captionSafeRegion: CaptionSafeRegionSchema.optional(), zoomEligible: z.boolean().optional(),
});
export type MotionBeat = z.infer<typeof MotionBeatSchema>;
export const MotionPlanSchema = z.object({ beats: z.array(MotionBeatSchema).min(1) });
export type MotionPlan = z.infer<typeof MotionPlanSchema>;
export function parseMotionPlan(input: unknown): MotionPlan { return MotionPlanSchema.parse(input); }
