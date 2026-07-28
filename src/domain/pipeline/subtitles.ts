import type { SceneRange, Subtitle } from "../models/media.js";
import type { Script } from "../models/script.js";

// Pure derivation, no I/O: caption text is already known from the Script segment (no audio
// transcription, per spec's `subtitles` requirement). Timing comes from the ASSEMBLED clip's REAL
// per-scene ranges (SceneAssembleStage's output), NOT a cumulative sum of planned/audio segment
// durations — capture only paces UP TO that target, but click+navigation makes a scene overshoot
// it, so the real on-screen scene runs longer than planned. That drift compounds across scenes,
// which is why subtitles used to land ~1 scene ahead of the video (e.g. an "expedientes" caption
// showing while "Importadores" was still on screen).
//
// A segment with no matching scene (privacy-cut, or otherwise absent from `scenes`) gets no
// subtitle — skipped, not thrown; PrivacyCutStage already rebases the kept script/scenes together
// before this runs, so a dangling segment here means it was intentionally dropped upstream.
export function deriveSubtitles(script: Script, scenes: readonly SceneRange[]): Subtitle[] {
  const rangeBySegmentId = new Map(scenes.map((scene) => [scene.narrationSegmentId, scene]));
  const subtitles: Subtitle[] = [];
  for (const segment of script.segments) {
    const range = rangeBySegmentId.get(segment.id);
    if (range === undefined) continue;
    subtitles.push({
      text: segment.text,
      startMs: range.startMs,
      durationMs: range.endMs - range.startMs,
    });
  }
  return subtitles;
}
