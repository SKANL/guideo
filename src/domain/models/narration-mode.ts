// Narration modes are intentionally backwards-compatible: "subtitles" remains the original
// captions-only CLI value, while "silent" produces no audio or embedded captions. Both modes
// still write the accessible captions sidecar at delivery time.
export type NarrationMode = "voice" | "subtitles" | "both" | "silent";

const NARRATION_MODES: readonly NarrationMode[] = ["voice", "subtitles", "both", "silent"];

export function parseNarrationMode(value: string): NarrationMode {
  if (!(NARRATION_MODES as readonly string[]).includes(value)) {
    throw new Error(`Invalid --narration value "${value}" (expected one of: ${NARRATION_MODES.join(", ")}).`);
  }
  return value as NarrationMode;
}
