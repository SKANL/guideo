import type { Subtitle } from "../models/media.js";
import type { Script } from "../models/script.js";

// Pure derivation, no I/O: caption text is already known from the Script segment (no audio
// transcription, per spec's `subtitles` requirement). startMs anchors to the segment's own
// planned timing; durationMs comes from the caller's per-segment duration map — RenderContext's
// segmentDurationsMs, which is the synthesized Audio's actual duration in "voice"/"both"
// narration mode, or the Script's own planned timing.durationMs in "subtitles" mode (no audio
// synthesized at all). deriveSubtitles doesn't need to know which — it just needs a duration.
export function deriveSubtitles(
  script: Script,
  segmentDurationsMs: ReadonlyMap<string, number>,
): Subtitle[] {
  return script.segments.map((segment) => {
    const durationMs = segmentDurationsMs.get(segment.id);
    if (durationMs === undefined) {
      throw new Error(`No known duration for Script segment "${segment.id}"`);
    }
    return {
      text: segment.text,
      startMs: segment.timing.startMs,
      durationMs,
    };
  });
}
