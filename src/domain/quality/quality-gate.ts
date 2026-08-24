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
  if ((expected.narration === "voice" || expected.narration === "both") && !probe.hasAudio) failures.push("voice output has no audio stream");
  if (expected.captionsRequired && !expected.hasCaptions) failures.push("output is missing required captions sidecar");
  if (expected.expectedVideoCodec && probe.videoCodec !== expected.expectedVideoCodec) failures.push(`output video codec ${probe.videoCodec ?? "unknown"} does not match required ${expected.expectedVideoCodec}`);
  if (expected.minimumWidth !== undefined && (probe.width ?? 0) < expected.minimumWidth) failures.push(`output width ${probe.width ?? 0} is below required ${expected.minimumWidth}`);
  if (expected.minimumHeight !== undefined && (probe.height ?? 0) < expected.minimumHeight) failures.push(`output height ${probe.height ?? 0} is below required ${expected.minimumHeight}`);
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
