import { z } from "zod";

// Basic v2 effect vocabulary (design doc section B). `params` stays a permissive record here —
// each effect type interprets its own params (crop rect, blur region+time-window, etc.) once the
// 4b ffmpeg EffectsEngine adapter exists; this phase only validates the `type` enum.
export const EffectTypeSchema = z.enum([
  "zoom-in",
  "zoom-out",
  "crop",
  "blur-region",
  "transition",
]);
export type EffectType = z.infer<typeof EffectTypeSchema>;

export const EffectSchema = z.object({
  type: EffectTypeSchema,
  params: z.record(z.string(), z.unknown()).default({}),
});
export type Effect = z.infer<typeof EffectSchema>;

export function parseEffect(input: unknown): Effect {
  return EffectSchema.parse(input);
}
