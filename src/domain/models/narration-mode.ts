// NarrationMode: whether render() produces synthesized voice narration, burned-in subtitles as a
// text-only alternative (no TTS call at all — unblocks local/CI validation runs that can't spend
// an ElevenLabs quota), or both (the default — preserves pre-narration-mode behavior: voice audio
// muxed in + soft subtitles attached).
export type NarrationMode = "voice" | "subtitles" | "both";

const NARRATION_MODES: readonly NarrationMode[] = ["voice", "subtitles", "both"];

export function parseNarrationMode(value: string): NarrationMode {
  if (!(NARRATION_MODES as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid --narration value "${value}" (expected one of: ${NARRATION_MODES.join(", ")}).`,
    );
  }
  return value as NarrationMode;
}
