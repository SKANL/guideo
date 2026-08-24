import type { EffectRegion, ResolvedEffect, SceneRange, SpeechTrack, Subtitle } from "../models/media.js";
import type { Script } from "../models/script.js";
import { projectOccupiedRegions, selectCaptionPlacement, type CaptionPlacement, type CaptionViewport } from "./caption-layout.js";

const MAX_CAPTION_LINE_LENGTH = 26;
const MAX_CAPTION_LINES = 2;
const MAX_CAPTION_CHARS_PER_SECOND = 20;
export type { CaptionPlacement } from "./caption-layout.js";
export type PlannedSubtitle = Subtitle & { readonly placement: CaptionPlacement };
export interface CaptionLayoutHints {
  readonly occupiedRegions?: readonly EffectRegion[];
  /** Render-profile viewport; omitted keeps the legacy 1280x720 placement geometry. */
  readonly viewport?: CaptionViewport;
}
export type CaptionLayoutHintsBySegment = ReadonlyMap<string, CaptionLayoutHints>;
export type TimedSpeech = SpeechTrack & { readonly segmentId: string };

export function captionLayoutHintsFromResolvedEffects(
  resolvedEffects: readonly ResolvedEffect[] | undefined,
  viewport?: CaptionViewport,
): CaptionLayoutHintsBySegment {
  const bySegment = new Map<string, EffectRegion[]>();
  for (const effect of resolvedEffects ?? []) {
    if (effect.region === null) continue;
    const region = viewport ? projectOccupiedRegions([effect.region], viewport)[0]! : effect.region;
    bySegment.set(effect.narrationSegmentId, [...(bySegment.get(effect.narrationSegmentId) ?? []), region]);
  }
  return new Map([...bySegment].map(([segmentId, occupiedRegions]) => [segmentId, { occupiedRegions }]));
}

function hardWrap(phrase: string): string[] {
  const lines: string[] = []; let line = "";
  for (const word of phrase.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > MAX_CAPTION_LINE_LENGTH) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function captionCues(text: string): string[] {
  const phrases: string[] = []; let phrase = "";
  for (const word of text.trim().split(/\s+/)) {
    phrase = phrase ? `${phrase} ${word}` : word;
    if (/[,.!?;:]$/.test(word)) {
      phrases.push(phrase); phrase = "";
    }
  }
  if (phrase) phrases.push(phrase);
  return phrases.flatMap((candidate) => {
    const lines = hardWrap(candidate);
    const cues: string[] = [];
    for (let index = 0; index < lines.length; index += MAX_CAPTION_LINES) cues.push(lines.slice(index, index + MAX_CAPTION_LINES).join("\n"));
    return cues;
  });
}
function placementFor(hints: CaptionLayoutHints): CaptionPlacement {
  return selectCaptionPlacement(hints.occupiedRegions, hints.viewport);
}
function caption(text: string, startMs: number, durationMs: number, placement: CaptionPlacement): PlannedSubtitle {
  const subtitle = { text, startMs, durationMs } as PlannedSubtitle;
  // Placement is rendering metadata. Keep the established Subtitle transport shape byte-for-byte
  // compatible for ports/clients that compare or serialize cue objects.
  Object.defineProperty(subtitle, "placement", { value: placement, enumerable: false });
  return subtitle;
}
function timedCues(text: string, speech: TimedSpeech | undefined): readonly { readonly text: string; readonly startMs: number; readonly endMs: number }[] | undefined {
  if (!speech || speech.approximate || speech.words.length === 0) return undefined;
  const phrases = captionCues(text).map((cue) => cue.replace("\n", " ").split(/\s+/));
  const output: { text: string; startMs: number; endMs: number }[] = [];
  let cursor = 0;
  for (const phrase of phrases) {
    const words = speech.words.slice(cursor, cursor + phrase.length);
    if (words.length !== phrase.length || words.map((word) => word.text).join(" ") !== phrase.join(" ")) return undefined;
    output.push({ text: phrase.join(" "), startMs: words[0]!.startMs, endMs: words.at(-1)!.endMs });
    cursor += phrase.length;
  }
  if (cursor !== speech.words.length) return undefined;
  // Keep speech alignment when it is readable; otherwise merge adjacent phrase cues rather than
  // flashing text faster than a viewer can consume it. No timestamps are invented.
  const readable: typeof output = [];
  for (let index = 0; index < output.length; index += 1) {
    let cue = output[index]!;
    while (index + 1 < output.length && (cue.text.replace(/\s/g, "").length * 1_000) / Math.max(1, cue.endMs - cue.startMs) > MAX_CAPTION_CHARS_PER_SECOND) {
      const next = output[++index]!;
      cue = { text: `${cue.text} ${next.text}`, startMs: cue.startMs, endMs: next.endMs };
    }
    readable.push(cue);
  }
  return readable;
}
export function deriveSubtitles(script: Script, scenes: readonly SceneRange[], hints: CaptionLayoutHints | CaptionLayoutHintsBySegment = {}, speechTracks: readonly TimedSpeech[] = [], placementOverrides: ReadonlyMap<string, CaptionPlacement> = new Map(), viewport?: CaptionViewport): PlannedSubtitle[] {
  const rangeBySegmentId = new Map(scenes.map((scene) => [scene.narrationSegmentId, scene]));
  const speechBySegmentId = new Map(speechTracks.map((speech) => [speech.segmentId, speech]));
  const subtitles: PlannedSubtitle[] = [];
  for (const segment of script.segments) {
    const range = rangeBySegmentId.get(segment.id); if (!range) continue;
    const storedHints = hints instanceof Map ? hints.get(segment.id) : hints;
    const segmentHints = viewport && !storedHints?.viewport ? { ...storedHints, viewport } : storedHints ?? {};
    const placement = placementOverrides.get(segment.id);
    const timed = timedCues(segment.text, speechBySegmentId.get(segment.id));
    if (timed) {
      subtitles.push(...timed.map((cue) => caption(cue.text, cue.startMs, cue.endMs - cue.startMs, placement ?? placementFor(segmentHints))));
      continue;
    }
    const cues = captionCues(segment.text); let startMs = range.startMs;
    let remainingDurationMs = range.endMs - range.startMs;
    let remainingWeight = cues.reduce((total, cue) => total + cue.replace("\n", " ").length, 0);
    for (const [index, text] of cues.entries()) {
      const weight = text.replace("\n", " ").length;
      const durationMs = index === cues.length - 1 ? remainingDurationMs : Math.round((remainingDurationMs * weight) / remainingWeight);
      subtitles.push(caption(text, startMs, durationMs, placement ?? placementFor(segmentHints)));
      startMs += durationMs; remainingDurationMs -= durationMs; remainingWeight -= weight;
    }
  }
  return subtitles;
}
