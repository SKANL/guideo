import { z } from "zod";

// TikTok/Facebook are typed here (spec's plugin-seams requirement lists them as future
// PlatformProfile seams) but have no wired PlatformProfile implementation this slice — see the
// non-goals list in the tasks doc. Only "youtube" is reachable end-to-end.
export const TargetPlatformSchema = z.enum(["youtube", "tiktok", "facebook"]);
export type TargetPlatform = z.infer<typeof TargetPlatformSchema>;

export const BriefSchema = z.object({
  idea: z.string().min(1),
  targetPlatform: TargetPlatformSchema,
});
export type Brief = z.infer<typeof BriefSchema>;

export function parseBrief(input: unknown): Brief {
  return BriefSchema.parse(input);
}
