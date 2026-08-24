import { describe, expect, it } from "vitest";
import { validatePhysicalRender } from "../../../src/app/validation/physical-render-validator.js";

const probe = {
  async probe() {
    return {
      durationMs: 2_000,
      hasVideo: true,
      hasAudio: true,
      videoCodec: "h264",
      width: 1_920,
      height: 1_080,
      videoStreams: 1,
      audioStreams: 1,
      subtitleStreams: 0,
    };
  },
};

describe("validatePhysicalRender", () => {
  it("validates MP4 metadata, captions, and every requested visual checkpoint", async () => {
    const report = await validatePhysicalRender({
      request: { videoPath: "fixture.mp4", srtPath: "fixture.srt", profile: "youtube", narration: "both", plannedDurationMs: 2_000, checkpointsMs: [0, 1_000, 1_999] },
      mediaProbe: probe,
      frameProbe: { capture: async (_videoPath, checkpoints) => checkpoints.map((atMs) => ({ atMs, bytes: 1 })) },
      readText: async () => "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
    });

    expect(report.status).toBe("passed");
    expect(report.metadata.width).toBe(1_920);
    expect(report.checkpoints).toHaveLength(3);
  });

  it("reports profile, narration, caption, and missing-frame failures without invoking quality evaluation", async () => {
    const report = await validatePhysicalRender({
      request: { videoPath: "fixture.mp4", srtPath: "fixture.srt", profile: "shorts", narration: "subtitles", plannedDurationMs: 1_000, checkpointsMs: [0, 500] },
      mediaProbe: { async probe() { return { durationMs: 500, hasVideo: true, hasAudio: true, width: 1_080, height: 1_080, videoStreams: 1, audioStreams: 1, subtitleStreams: 0 }; } },
      frameProbe: { capture: async () => [{ atMs: 0, bytes: 0 }] },
      readText: async () => "",
    });

    expect(report.status).toBe("failed");
    expect(report.failures).toEqual(expect.arrayContaining([
      "shorts output must be 1080x1920; received 1080x1080",
      "subtitles output must not contain an audio stream",
      "captions sidecar is empty",
      "frame checkpoint 0ms is empty",
      "frame checkpoint 500ms was not returned",
    ]));
  });

  it.each([
    ["youtube", "voice", 1_920, 1_080, true],
    ["shorts", "both", 1_080, 1_920, true],
    ["square", "silent", 1_080, 1_080, false],
  ] as const)("accepts %s/%s metadata", async (profile, narration, width, height, hasAudio) => {
    const report = await validatePhysicalRender({
      request: { videoPath: "fixture.mp4", srtPath: "fixture.srt", profile, narration, plannedDurationMs: 1_000, checkpointsMs: [0] },
      mediaProbe: { async probe() { return { durationMs: 1_000, hasVideo: true, hasAudio, videoCodec: "h264", width, height }; } },
      frameProbe: { capture: async () => [{ atMs: 0, bytes: 10 }] },
      readText: async () => "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
    });
    expect(report.status).toBe("passed");
  });
});
