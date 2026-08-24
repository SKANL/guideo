import { describe, expect, it } from "vitest";
import { FfmpegMediaProbe } from "../../../src/adapters/media/ffmpeg-media-probe.js";

describe("FfmpegMediaProbe", () => {
  it("parses metadata emitted to stderr by a successful ffmpeg process", async () => {
    const probe = new FfmpegMediaProbe(async () => ({
      stderr: "Duration: 00:01:02.500, start: 0.000000, bitrate: 1000 kb/s\\nStream #0:0: Video: h264\\nStream #0:1: Audio: aac",
    }));

    await expect(probe.probe("output.mp4")).resolves.toEqual({ durationMs: 62_500, hasVideo: true, hasAudio: true });
  });

  it("surfaces a probe failure when ffmpeg returns no media metadata", async () => {
    const probe = new FfmpegMediaProbe(async () => ({ stderr: "invalid data" }));

    await expect(probe.probe("broken.mp4")).rejects.toThrow("media probe failed for broken.mp4: no duration found");
  });
});
