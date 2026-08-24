import { describe, expect, it, vi } from "vitest";
import { FfmpegMediaProbe } from "../../../src/adapters/media/ffmpeg-media-probe.js";

describe("FfmpegMediaProbe", () => {
  it("parses metadata emitted to stderr by a successful ffmpeg process", async () => {
    const probe = new FfmpegMediaProbe(async () => ({
      stderr: "Duration: 00:01:02.500, start: 0.000000, bitrate: 1000 kb/s\\nStream #0:0: Video: h264\\nStream #0:1: Audio: aac",
    }));

    await expect(probe.probe("output.mp4")).resolves.toMatchObject({
      durationMs: 62_500,
      hasVideo: true,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
      videoStreams: 1,
      audioStreams: 1,
      evidence: { command: "ffprobe", path: "output.mp4" },
    });
  });

  it("surfaces a probe failure when ffmpeg returns no media metadata", async () => {
    const probe = new FfmpegMediaProbe(async () => ({ stderr: "invalid data" }));

    await expect(probe.probe("broken.mp4")).rejects.toThrow("media probe failed for broken.mp4: no duration found");
  });

  it("uses an injected execFile-style boundary with a literal argv and parses all stream counts", async () => {
    const exec = vi.fn(async () => ({ stdout: JSON.stringify({ format: { duration: "2.5" }, streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }, { codec_type: "audio", codec_name: "aac" }, { codec_type: "subtitle", codec_name: "mov_text" }] }) }));
    const result = await new FfmpegMediaProbe(exec, "ffprobe").probe("unsafe; rm -rf / .mp4");

    expect(exec).toHaveBeenCalledWith("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", "unsafe; rm -rf / .mp4"]);
    expect(result).toMatchObject({ durationMs: 2_500, videoStreams: 1, audioStreams: 1, subtitleStreams: 1, videoCodec: "h264", audioCodec: "aac", width: 1920, height: 1080 });
  });
});
