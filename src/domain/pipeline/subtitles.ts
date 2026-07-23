import type { Audio, Subtitle } from "../models/media.js";
import type { Script } from "../models/script.js";

// Pure derivation, no I/O: caption text is already known from the Script segment (no audio
// transcription, per spec's `subtitles` requirement). startMs anchors to the segment's own
// planned timing; durationMs uses the synthesized Audio's actual duration (which may differ
// from the Script's provisional estimate) so captions stay aligned to real narration timing.
export function deriveSubtitles(script: Script, audioTracks: readonly Audio[]): Subtitle[] {
  const audioBySegmentId = new Map(audioTracks.map((audio) => [audio.segmentId, audio]));
  return script.segments.map((segment) => {
    const audio = audioBySegmentId.get(segment.id);
    if (!audio) {
      throw new Error(`No synthesized Audio for Script segment "${segment.id}"`);
    }
    return {
      text: segment.text,
      startMs: segment.timing.startMs,
      durationMs: audio.durationMs,
    };
  });
}
