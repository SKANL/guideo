import type { NarrationMode } from "../models/narration-mode.js";
import type { SceneRange } from "../models/media.js";
import type { MediaProbeResult } from "../ports/media-probe.js";

export interface QualityExpectation {
  readonly expectedDurationMs: number;
  readonly minimumDurationRatio?: number;
  readonly expectedSegments: number;
  readonly actualSegments: number;
  readonly narration: NarrationMode;
  readonly captionsRequired?: boolean;
  readonly hasCaptions?: boolean;
  readonly sceneRanges?: readonly SceneRange[];
  readonly expectedVideoCodec?: string;
  readonly minimumWidth?: number;
  readonly minimumHeight?: number;
  readonly maximumSyncP95Ms?: number;
  readonly actionWordOffsetsMs?: readonly number[];
  readonly maximumActionWordOffsetMs?: number;
  readonly deadAir?: readonly { readonly kind: string; readonly durationMs: number; readonly intentional: boolean }[];
  readonly maximumUnintentionalDeadAirMs?: number;
  readonly captionEvidence?: { readonly coverage: number; readonly legible: boolean; readonly occluded: boolean };
  readonly maximumFrozenFrameRatio?: number;
  readonly maximumBlackFrameRatio?: number;
  readonly expectedVideoStreams?: number;
  readonly expectedAudioStreams?: number;
  readonly expectedSubtitleStreams?: number;
  readonly provenanceRequired?: boolean;
  readonly hasProvenance?: boolean;
}

export interface QualityReport {
  readonly status: "passed" | "failed";
  readonly failures: readonly string[];
}

export function evaluateQuality(probe: MediaProbeResult, expected: QualityExpectation): QualityReport {
  const failures: string[] = [];
  if (!probe.hasVideo) failures.push("output has no video stream");
  const minimumDurationMs = expected.expectedDurationMs * (expected.minimumDurationRatio ?? 1);
  if (probe.durationMs < minimumDurationMs) failures.push(`output duration ${probe.durationMs}ms is shorter than planned ${expected.expectedDurationMs}ms`);
  if (expected.actualSegments !== expected.expectedSegments) failures.push(`storyboard covers ${expected.actualSegments} segments; expected ${expected.expectedSegments}`);
  if (expected.narration === "silent" && probe.hasAudio) failures.push("silent output must not contain an audio stream");
  if (expected.narration === "subtitles" && (probe.hasAudio || (probe.audioStreams ?? 0) > 0)) failures.push("subtitles output must not contain an audio stream");
  if ((expected.narration === "voice" || expected.narration === "both") && !probe.hasAudio) failures.push("voice output has no audio stream");
  if (expected.captionsRequired && !expected.hasCaptions) failures.push("output is missing required captions sidecar");
  if (expected.expectedVideoCodec && probe.videoCodec !== expected.expectedVideoCodec) failures.push(`output video codec ${probe.videoCodec ?? "unknown"} does not match required ${expected.expectedVideoCodec}`);
  if (expected.minimumWidth !== undefined && (probe.width ?? 0) < expected.minimumWidth) failures.push(`output width ${probe.width ?? 0} is below required ${expected.minimumWidth}`);
  if (expected.minimumHeight !== undefined && (probe.height ?? 0) < expected.minimumHeight) failures.push(`output height ${probe.height ?? 0} is below required ${expected.minimumHeight}`);
  if (expected.maximumSyncP95Ms !== undefined && (probe.syncP95Ms ?? 0) > expected.maximumSyncP95Ms) failures.push(`sync p95 ${probe.syncP95Ms}ms exceeds ${expected.maximumSyncP95Ms}ms`);
  for (const offset of expected.actionWordOffsetsMs ?? []) if (expected.maximumActionWordOffsetMs !== undefined && offset > expected.maximumActionWordOffsetMs) failures.push(`action-word timing offset ${offset}ms exceeds ${expected.maximumActionWordOffsetMs}ms`);
  for (const pause of expected.deadAir ?? []) if (!pause.intentional && expected.maximumUnintentionalDeadAirMs !== undefined && pause.durationMs > expected.maximumUnintentionalDeadAirMs) failures.push(`unintentional ${pause.kind} dead air ${pause.durationMs}ms exceeds ${expected.maximumUnintentionalDeadAirMs}ms`);
  if (expected.captionEvidence && expected.captionEvidence.coverage < 1) failures.push(`caption coverage ${expected.captionEvidence.coverage * 100}% is incomplete`);
  if (expected.captionEvidence && !expected.captionEvidence.legible) failures.push("captions are not legible");
  if (expected.captionEvidence?.occluded) failures.push("captions are occluded");
  if (expected.maximumFrozenFrameRatio !== undefined && (probe.frozenFrameRatio ?? 0) > expected.maximumFrozenFrameRatio) failures.push(`frozen-frame ratio ${(probe.frozenFrameRatio ?? 0) * 100}% exceeds ${expected.maximumFrozenFrameRatio * 100}%`);
  if (expected.maximumBlackFrameRatio !== undefined && (probe.blackFrameRatio ?? 0) > expected.maximumBlackFrameRatio) failures.push(`black-frame ratio ${(probe.blackFrameRatio ?? 0) * 100}% exceeds ${expected.maximumBlackFrameRatio * 100}%`);
  if (expected.expectedVideoStreams !== undefined && probe.videoStreams !== expected.expectedVideoStreams) failures.push(`output has ${probe.videoStreams ?? 0} video streams; expected ${expected.expectedVideoStreams}`);
  if (expected.expectedAudioStreams !== undefined && probe.audioStreams !== expected.expectedAudioStreams) failures.push(`output has ${probe.audioStreams ?? 0} audio streams; expected ${expected.expectedAudioStreams}`);
  if (expected.expectedSubtitleStreams !== undefined && probe.subtitleStreams !== expected.expectedSubtitleStreams) failures.push(`output has ${probe.subtitleStreams ?? 0} subtitle streams; expected ${expected.expectedSubtitleStreams}`);
  if (expected.provenanceRequired && !expected.hasProvenance) failures.push("output is missing required provenance");
  for (let index = 1; index < (expected.sceneRanges?.length ?? 0); index += 1) {
    const previous = expected.sceneRanges![index - 1]!;
    const current = expected.sceneRanges![index]!;
    if (previous.endMs > current.startMs) failures.push(`scene ranges overlap: ${previous.narrationSegmentId} ends at ${previous.endMs}ms after ${current.narrationSegmentId} starts at ${current.startMs}ms`);
  }
  return { status: failures.length === 0 ? "passed" : "failed", failures };
}

export function assertQuality(probe: MediaProbeResult, expected: QualityExpectation): QualityReport {
  const report = evaluateQuality(probe, expected);
  if (report.status === "failed") throw new Error(`quality gate failed: ${report.failures.join("; ")}`);
  return report;
}
