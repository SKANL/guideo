import type { SceneRange, Subtitle } from "../models/media.js";
import type { Script } from "../models/script.js";

const MAX_CAPTION_LINE_LENGTH = 42;
const MAX_CAPTION_LINES = 2;

function captionCues(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && next.length > MAX_CAPTION_LINE_LENGTH) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);

  const cues: string[] = [];
  for (let index = 0; index < lines.length; index += MAX_CAPTION_LINES) {
    cues.push(lines.slice(index, index + MAX_CAPTION_LINES).join("\n"));
  }
  return cues;
}

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
    const cues = captionCues(segment.text);
    const sceneDurationMs = range.endMs - range.startMs;
    let startMs = range.startMs;
    let remainingDurationMs = sceneDurationMs;
    let remainingWeight = cues.reduce((total, cue) => total + cue.replace("\n", " ").length, 0);
    for (const [index, text] of cues.entries()) {
      const weight = text.replace("\n", " ").length;
      const durationMs = index === cues.length - 1
        ? remainingDurationMs
        : Math.round((remainingDurationMs * weight) / remainingWeight);
      subtitles.push({ text, startMs, durationMs });
      startMs += durationMs;
      remainingDurationMs -= durationMs;
      remainingWeight -= weight;
    }
  }
  return subtitles;
}
