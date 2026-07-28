// Privacy/redaction: cut private scenes (design doc section C, sub-project 5b). Pure, no I/O — a
// scene is a group of storyboard steps sharing one narrationSegmentId (mirrors WebRecordingEngine's
// groupIntoScenes); it's classified PRIVATE if ANY of its steps carries `visibility: "private"`.
// Cutting removes that scene's time range from the video and its narration segment from the
// audio/subtitles, then REBASES every kept scene's timing contiguous from 0 so the concatenated
// output has no gaps. Effects need no separate "re-gating" step here: FfmpegPrivacyCutter returns a
// RawClip whose `scenes` are already rebased, and the downstream EffectsEngine (effects-graph.ts)
// looks up each step's gate FROM clip.scenes — private steps' narrationSegmentId is simply absent
// from the cut clip's scenes, so their effects are skipped for free (same "no matching scene range"
// path already exercised by effects-graph.test.ts), and kept steps' effects gate to the REBASED
// times automatically.
import type { Audio, SceneRange } from "../models/media.js";
import type { Script } from "../models/script.js";
import type { ApprovedStoryboard, StoryboardStep } from "../models/storyboard.js";

export function derivePrivateSegmentIds(steps: readonly StoryboardStep[]): Set<string> {
  const ids = new Set<string>();
  for (const step of steps) {
    if (step.visibility === "private") {
      ids.add(step.narrationSegmentId);
    }
  }
  return ids;
}

export interface KeptScene {
  readonly narrationSegmentId: string;
  // Original (source clip) range — what ffmpeg must select/trim out of the pre-cut video.
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  // Rebased range — contiguous from 0 across all kept scenes, in order.
  readonly startMs: number;
  readonly endMs: number;
}

export interface ScenePrivacyPlan {
  readonly kept: readonly KeptScene[];
  // True when every input scene survived (nothing private) — the fast passthrough signal: no
  // ffmpeg, no rebasing needed anywhere downstream.
  readonly isNoop: boolean;
}

export function planSceneCut(
  scenes: readonly SceneRange[],
  privateSegmentIds: ReadonlySet<string>,
): ScenePrivacyPlan {
  const survivors = scenes.filter((scene) => !privateSegmentIds.has(scene.narrationSegmentId));
  const isNoop = survivors.length === scenes.length;

  let cursor = 0;
  const kept: KeptScene[] = survivors.map((scene) => {
    const durationMs = scene.endMs - scene.startMs;
    const startMs = cursor;
    const endMs = cursor + durationMs;
    cursor = endMs;
    return {
      narrationSegmentId: scene.narrationSegmentId,
      sourceStartMs: scene.startMs,
      sourceEndMs: scene.endMs,
      startMs,
      endMs,
    };
  });

  return { kept, isNoop };
}

// Rebuilds the Script with only kept segments, timing.startMs recomputed as the cumulative sum of
// the KEPT audio tracks' actual durations (in their original order) — this is what the concatenated
// output's real audio timeline will be (compose concatenates audioTracks by duration, ignoring
// Script's own provisional startMs), so subtitles derived from this rebased Script land correctly.
export function deriveKeptScript(
  script: Script,
  keptSegmentIds: ReadonlySet<string>,
  audioTracks: readonly Audio[],
): Script {
  let cursor = 0;
  const startMsBySegment = new Map<string, number>();
  for (const audio of audioTracks) {
    if (!keptSegmentIds.has(audio.segmentId)) continue;
    startMsBySegment.set(audio.segmentId, cursor);
    cursor += audio.durationMs;
  }

  return {
    segments: script.segments
      .filter((segment) => keptSegmentIds.has(segment.id))
      .map((segment) => ({
        ...segment,
        timing: {
          ...segment.timing,
          startMs: startMsBySegment.get(segment.id) ?? segment.timing.startMs,
        },
      })),
  };
}

export function filterKeptAudioTracks(
  audioTracks: readonly Audio[],
  keptSegmentIds: ReadonlySet<string>,
): Audio[] {
  return audioTracks.filter((audio) => keptSegmentIds.has(audio.segmentId));
}

export interface PrivacyCutPlan extends ScenePrivacyPlan {
  readonly script: Script;
  readonly audioTracks: readonly Audio[];
}

// Single entry point combining scene privacy derivation + video/audio/script cut+rebase. In the
// no-op case, script/audioTracks are returned BY REFERENCE, unchanged — the caller (adapter) uses
// this to skip ffmpeg entirely.
export function planPrivacyCut(
  clipScenes: readonly SceneRange[],
  storyboard: ApprovedStoryboard,
  script: Script,
  audioTracks: readonly Audio[],
): PrivacyCutPlan {
  const privateSegmentIds = derivePrivateSegmentIds(storyboard.steps);
  const { kept, isNoop } = planSceneCut(clipScenes, privateSegmentIds);

  if (isNoop) {
    return { kept, isNoop, script, audioTracks };
  }

  const keptSegmentIds = new Set(kept.map((scene) => scene.narrationSegmentId));
  return {
    kept,
    isNoop,
    script: deriveKeptScript(script, keptSegmentIds, audioTracks),
    audioTracks: filterKeptAudioTracks(audioTracks, keptSegmentIds),
  };
}
