import type { EffectRegion, ResolvedEffect, SceneRange, Subtitle } from "../models/media.js";
import type { Script } from "../models/script.js";

const MAX_CAPTION_LINE_LENGTH = 26;
const MAX_CAPTION_LINES = 2;
const LOWER_THIRD = { x: 96, y: 510, w: 1088, h: 150 };

export type CaptionPlacement = "lower-third" | "top" | "bottom-left" | "bottom-right";
export type PlannedSubtitle = Subtitle & { readonly placement: CaptionPlacement };
export interface CaptionLayoutHints { readonly occupiedRegions?: readonly EffectRegion[]; }
export type CaptionLayoutHintsBySegment = ReadonlyMap<string, CaptionLayoutHints>;

export function captionLayoutHintsFromResolvedEffects(
  resolvedEffects: readonly ResolvedEffect[] | undefined,
): CaptionLayoutHintsBySegment {
  const bySegment = new Map<string, EffectRegion[]>();
  for (const effect of resolvedEffects ?? []) {
    if (effect.region === null) continue;
    bySegment.set(effect.narrationSegmentId, [...(bySegment.get(effect.narrationSegmentId) ?? []), effect.region]);
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
    if (/[,.!?;:]$/.test(word) || /^(and|but|then|so|while|because|after|before)$/i.test(word)) {
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
function intersects(a: EffectRegion, b: EffectRegion): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function placementFor(hints: CaptionLayoutHints): CaptionPlacement {
  // Lower-third is the default action-safe area. A known overlapping target/result moves the cue
  // to the top rather than covering the proof the viewer needs to see.
  return hints.occupiedRegions?.some((region) => intersects(region, LOWER_THIRD)) ? "top" : "lower-third";
}
function caption(text: string, startMs: number, durationMs: number, placement: CaptionPlacement): PlannedSubtitle {
  const subtitle = { text, startMs, durationMs } as PlannedSubtitle;
  // Placement is rendering metadata. Keep the established Subtitle transport shape byte-for-byte
  // compatible for ports/clients that compare or serialize cue objects.
  Object.defineProperty(subtitle, "placement", { value: placement, enumerable: false });
  return subtitle;
}
export function deriveSubtitles(script: Script, scenes: readonly SceneRange[], hints: CaptionLayoutHints | CaptionLayoutHintsBySegment = {}): PlannedSubtitle[] {
  const rangeBySegmentId = new Map(scenes.map((scene) => [scene.narrationSegmentId, scene]));
  const subtitles: PlannedSubtitle[] = [];
  for (const segment of script.segments) {
    const range = rangeBySegmentId.get(segment.id); if (!range) continue;
    const cues = captionCues(segment.text); let startMs = range.startMs;
    let remainingDurationMs = range.endMs - range.startMs;
    let remainingWeight = cues.reduce((total, cue) => total + cue.replace("\n", " ").length, 0);
    for (const [index, text] of cues.entries()) {
      const weight = text.replace("\n", " ").length;
      const durationMs = index === cues.length - 1 ? remainingDurationMs : Math.round((remainingDurationMs * weight) / remainingWeight);
      const segmentHints = hints instanceof Map ? hints.get(segment.id) ?? {} : hints;
      subtitles.push(caption(text, startMs, durationMs, placementFor(segmentHints)));
      startMs += durationMs; remainingDurationMs -= durationMs; remainingWeight -= weight;
    }
  }
  return subtitles;
}
