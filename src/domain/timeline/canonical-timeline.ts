import { sha256 } from "../artifacts/canonical.js";
import type { AudioProvenance } from "../models/media.js";

export type SemanticTarget = { readonly role?: string; readonly accessibleName?: string; readonly label?: string; readonly testId?: string };
export type WordTiming = { readonly text: string; readonly startMs: number; readonly endMs: number };
export type SpeechTrack = { readonly segmentId: string; readonly words: readonly WordTiming[]; readonly approximate: boolean; readonly provenance?: AudioProvenance };
export type AttentionCue = { readonly segmentId: string; readonly kind: "zoom" | "crop" | "callout"; readonly entryMs: number; readonly apexMs: number; readonly exitMs: number; readonly rationale: string; readonly target: SemanticTarget; readonly evidenceRefs: readonly string[] };
export type TimelineInput = { readonly script: { readonly segments: readonly { readonly id: string; readonly text: string; readonly timing: { readonly startMs: number; readonly durationMs: number } }[] }; readonly speech?: readonly SpeechTrack[]; readonly actions?: readonly { readonly segmentId: string; readonly kind: string; readonly startMs: number; readonly endMs: number; readonly target: SemanticTarget; readonly evidenceRefs: readonly string[] }[]; readonly cues?: readonly AttentionCue[]; readonly pauses?: readonly { readonly startMs: number; readonly endMs: number; readonly kind: "typing" | "loading" | "confirmation" | "comprehension"; readonly intentional: boolean }[] };

function fallbackWords(text: string, startMs: number, durationMs: number): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean); const base = Math.floor(durationMs / Math.max(words.length, 1));
  return words.map((word, index) => ({ text: word, startMs: startMs + base * index, endMs: index === words.length - 1 ? startMs + durationMs : startMs + base * (index + 1) }));
}
export function buildCanonicalTimeline(input: TimelineInput) {
  const supplied = new Map(input.speech?.map((track) => [track.segmentId, track]) ?? []);
  const speech = input.script.segments.map((segment) => supplied.get(segment.id) ?? { segmentId: segment.id, words: fallbackWords(segment.text, segment.timing.startMs, segment.timing.durationMs), approximate: true });
  const captions = input.script.segments.map((segment) => {
    const track = supplied.get(segment.id);
    const words = track?.words;
    return { text: segment.text, startMs: words?.[0]?.startMs ?? segment.timing.startMs, endMs: words?.at(-1)?.endMs ?? segment.timing.startMs + segment.timing.durationMs, source: track && !track.approximate ? "provider" as const : "approximate" as const, ...(track?.provenance ? { provenance: track.provenance } : {}) };
  });
  const canonical = { speech, captions, actions: input.actions ?? [], cues: input.cues ?? [], pauses: input.pauses ?? [] }; const hash = sha256(canonical);
  return { ...canonical, hash, qaHash: hash };
}

export function evaluateTimelineQuality(timeline: ReturnType<typeof buildCanonicalTimeline>) {
  const failures: string[] = []; const total = Math.max(...timeline.captions.map((caption) => caption.endMs), 1);
  if (timeline.speech.some((track) => !timeline.captions.some((caption) => caption.startMs <= track.words[0]!.startMs && caption.endMs >= track.words.at(-1)!.endMs))) failures.push("caption coverage is incomplete");
  for (let i = 1; i < timeline.cues.length; i += 1) if (timeline.cues[i - 1]!.exitMs > timeline.cues[i]!.entryMs) failures.push("attention cue overlap");
  if (timeline.cues.some((cue) => !cue.rationale || !cue.target || cue.evidenceRefs.length === 0)) failures.push("attention cue lacks semantic evidence");
  const unintentional = timeline.pauses.filter((pause) => !pause.intentional).reduce((sum, pause) => sum + pause.endMs - pause.startMs, 0); if (unintentional / total > 0.05) failures.push("dead-air ratio exceeds 5%");
  return { status: failures.length ? "failed" as const : "passed" as const, failures };
}
