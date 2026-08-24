import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { FrameCheckpoint, FrameCheckpointProbe } from "../../domain/ports/frame-checkpoint-probe.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";

const execFile = promisify(execFileCallback);

export interface FfmpegFrameExecResult {
  readonly stdout?: Uint8Array;
}

export type FfmpegFrameExec = (binary: string, argv: readonly string[]) => Promise<FfmpegFrameExecResult>;

async function defaultExec(binary: string, argv: readonly string[]): Promise<FfmpegFrameExecResult> {
  const result = await execFile(binary, [...argv], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  return { stdout: result.stdout as Uint8Array };
}

/** Extracts decodable PNG frame checkpoints without retaining generated images on disk. */
export class FfmpegFrameCheckpointProbe implements FrameCheckpointProbe {
  constructor(private readonly exec: FfmpegFrameExec = defaultExec, private readonly ffmpegPath = resolveFfmpegPath()) {}

  async capture(videoPath: string, checkpointsMs: readonly number[]): Promise<readonly FrameCheckpoint[]> {
    const frames = await this.extract(videoPath, checkpointsMs);
    return frames.map(({ atMs, bytes }) => ({ atMs, bytes: bytes.byteLength }));
  }

  async extract(videoPath: string, checkpointsMs: readonly number[]): Promise<readonly { readonly atMs: number; readonly bytes: Uint8Array }[]> {
    return Promise.all(checkpointsMs.map(async (atMs) => {
      const argv = ["-v", "error", "-ss", String(atMs / 1_000), "-i", videoPath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"];
      const result = await this.exec(this.ffmpegPath, argv);
      return { atMs, bytes: result.stdout ?? new Uint8Array() };
    }));
  }
}
