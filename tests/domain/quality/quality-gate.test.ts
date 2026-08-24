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

  it("fails deterministic media defects: missing required captions, unexpected silence, and overlapping scenes", () => {
    const report = evaluateQuality(
      { durationMs: 3_000, hasVideo: true, hasAudio: false, videoStreams: 1, audioStreams: 0 },
      {
        expectedDurationMs: 3_000,
        expectedSegments: 2,
        actualSegments: 2,
        narration: "both",
        captionsRequired: true,
        hasCaptions: false,
        sceneRanges: [
          { narrationSegmentId: "one", startMs: 0, endMs: 2_000 },
          { narrationSegmentId: "two", startMs: 1_500, endMs: 3_000 },
        ],
      },
    );

    expect(report.failures).toEqual([
      "voice output has no audio stream",
      "output is missing required captions sidecar",
      "scene ranges overlap: one ends at 2000ms after two starts at 1500ms",
    ]);
  });

  it("requires a deterministic H.264 delivery at the configured resolution", () => {
    const report = evaluateQuality(
      { durationMs: 3_000, hasVideo: true, hasAudio: false, videoCodec: "vp9", width: 1280, height: 720 },
      { expectedDurationMs: 3_000, expectedSegments: 1, actualSegments: 1, narration: "silent", expectedVideoCodec: "h264", minimumWidth: 1920, minimumHeight: 1080 },
    );

    expect(report.failures).toEqual([
      "output video codec vp9 does not match required h264",
      "output width 1280 is below required 1920",
      "output height 720 is below required 1080",
    ]);
  });
});
