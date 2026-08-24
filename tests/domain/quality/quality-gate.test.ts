import { describe, expect, it } from "vitest";
import { evaluateQuality } from "../../../src/domain/quality/quality-gate.js";

describe("quality gate", () => {
  it("accepts a complete silent delivery whose duration and segment count match the plan", () => {
    expect(evaluateQuality({ durationMs: 3_000, hasVideo: true, hasAudio: false }, { expectedDurationMs: 3_000, expectedSegments: 2, actualSegments: 2, narration: "silent" })).toEqual({ status: "passed", failures: [] });
  });

  it("returns explicit actionable failures for missing video, short duration, segment mismatch, and forbidden audio", () => {
    const report = evaluateQuality({ durationMs: 1_000, hasVideo: false, hasAudio: true }, { expectedDurationMs: 3_000, expectedSegments: 2, actualSegments: 1, narration: "silent" });

    expect(report.status).toBe("failed");
    expect(report.failures).toEqual([
      "output has no video stream",
      "output duration 1000ms is shorter than planned 3000ms",
      "storyboard covers 1 segments; expected 2",
      "silent output must not contain an audio stream",
    ]);
  });

  it("requires audio for voice-plus-captions delivery", () => {
    expect(evaluateQuality({ durationMs: 3_000, hasVideo: true, hasAudio: false }, { expectedDurationMs: 3_000, expectedSegments: 1, actualSegments: 1, narration: "both" }).failures).toEqual(["voice output has no audio stream"]);
  });

  it("rejects incomplete planned segment evidence and required captions", () => {
    const report = evaluateQuality(
      { durationMs: 3_000, hasVideo: true, hasAudio: true },
      { expectedDurationMs: 3_000, expectedSegments: 2, actualSegments: 1, narration: "voice", captionsRequired: true, hasCaptions: false },
    );

    expect(report.failures).toEqual([
      "storyboard covers 1 segments; expected 2",
      "output is missing required captions sidecar",
    ]);
  });
});
