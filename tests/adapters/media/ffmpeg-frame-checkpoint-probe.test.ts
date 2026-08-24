import { describe, expect, it } from "vitest";
import { FfmpegFrameCheckpointProbe } from "../../../src/adapters/media/ffmpeg-frame-checkpoint-probe.js";

describe("FfmpegFrameCheckpointProbe", () => {
  it("captures a PNG checkpoint for each requested timestamp", async () => {
    const calls: string[][] = [];
    const probe = new FfmpegFrameCheckpointProbe(async (binary, argv) => {
      expect(binary).toBe("fixture-ffmpeg");
      calls.push([...argv]);
      return { stdout: Uint8Array.from([137, 80, 78, 71]) };
    }, "fixture-ffmpeg");

    await expect(probe.extract("output.mp4", [0, 1_250])).resolves.toEqual([
      { atMs: 0, bytes: Uint8Array.from([137, 80, 78, 71]) },
      { atMs: 1_250, bytes: Uint8Array.from([137, 80, 78, 71]) },
    ]);
    expect(calls[1]).toEqual(["-v", "error", "-ss", "1.25", "-i", "output.mp4", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]);
  });
});
