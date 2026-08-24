import { z } from "zod";

export const MotionBeatKindSchema = z.enum(["setup", "action", "reaction", "hold"]);
export type MotionBeatKind = z.infer<typeof MotionBeatKindSchema>;

export const MotionTargetSchema = z.object({
  selector: z.string().min(1),
  evidence: z.string().min(1),
});
export type MotionTarget = z.infer<typeof MotionTargetSchema>;

export const MotionBeatSchema = z.object({
  kind: MotionBeatKindSchema,
  narrationSegmentId: z.string().min(1),
  stepIndex: z.number().int().nonnegative(),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  target: MotionTargetSchema.optional(),
});
export type MotionBeat = z.infer<typeof MotionBeatSchema>;

export const MotionPlanSchema = z.object({
  beats: z.array(MotionBeatSchema).min(1),
});
export type MotionPlan = z.infer<typeof MotionPlanSchema>;

export function parseMotionPlan(input: unknown): MotionPlan {
  return MotionPlanSchema.parse(input);
}
