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

  it("blocks sync, action timing, classified dead air, caption, frame, stream, and provenance defects", () => {
    const report = evaluateQuality(
      { durationMs: 3_000, hasVideo: true, hasAudio: false, videoCodec: "vp9", width: 1280, height: 720, videoStreams: 2, audioStreams: 1, subtitleStreams: 0, syncP95Ms: 250, frozenFrameRatio: 0.2, blackFrameRatio: 0.1 },
      { expectedDurationMs: 3_000, expectedSegments: 1, actualSegments: 1, narration: "subtitles", captionsRequired: true, hasCaptions: true, expectedVideoCodec: "h264", minimumWidth: 1920, minimumHeight: 1080, maximumSyncP95Ms: 100, actionWordOffsetsMs: [150], maximumActionWordOffsetMs: 100, deadAir: [{ kind: "loading", durationMs: 500, intentional: false }], maximumUnintentionalDeadAirMs: 200, captionEvidence: { coverage: 0.8, legible: false, occluded: true }, maximumFrozenFrameRatio: 0.05, maximumBlackFrameRatio: 0.01, expectedVideoStreams: 1, expectedAudioStreams: 0, expectedSubtitleStreams: 1, provenanceRequired: true, hasProvenance: false },
    );

    expect(report.failures).toEqual([
      "subtitles output must not contain an audio stream",
      "output video codec vp9 does not match required h264",
      "output width 1280 is below required 1920",
      "output height 720 is below required 1080",
      "sync p95 250ms exceeds 100ms",
      "action-word timing offset 150ms exceeds 100ms",
      "unintentional loading dead air 500ms exceeds 200ms",
      "caption coverage 80% is incomplete",
      "captions are not legible",
      "captions are occluded",
      "frozen-frame ratio 20% exceeds 5%",
      "black-frame ratio 10% exceeds 1%",
      "output has 2 video streams; expected 1",
      "output has 1 audio streams; expected 0",
      "output has 0 subtitle streams; expected 1",
      "output is missing required provenance",
    ]);
  });
});
