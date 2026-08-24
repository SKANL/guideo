import type { NarrationMode } from "../models/narration-mode.js";
import type { MediaProbeResult } from "../ports/media-probe.js";

export interface QualityExpectation {
  readonly expectedDurationMs: number;
  readonly minimumDurationRatio?: number;
  readonly expectedSegments: number;
  readonly actualSegments: number;
  readonly narration: NarrationMode;
  readonly captionsRequired?: boolean;
  readonly hasCaptions?: boolean;
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
  return { status: failures.length === 0 ? "passed" : "failed", failures };
}

export function assertQuality(probe: MediaProbeResult, expected: QualityExpectation): QualityReport {
  const report = evaluateQuality(probe, expected);
  if (report.status === "failed") throw new Error(`quality gate failed: ${report.failures.join("; ")}`);
  return report;
}
