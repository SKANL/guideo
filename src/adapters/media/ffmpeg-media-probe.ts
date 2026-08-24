import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { MediaProbe, MediaProbeResult } from "../../domain/ports/media-probe.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";

const execFile = promisify(execFileCallback);

export interface FfmpegProbeExecResult {
  readonly stderr: string;
}

export type FfmpegProbeExec = (ffmpegPath: string, argv: readonly string[]) => Promise<FfmpegProbeExecResult>;

async function defaultExec(ffmpegPath: string, argv: readonly string[]): Promise<FfmpegProbeExecResult> {
  const result = await execFile(ffmpegPath, [...argv]);
  return { stderr: String(result.stderr) };
}

export class FfmpegMediaProbe implements MediaProbe {
  constructor(private readonly exec: FfmpegProbeExec = defaultExec) {}

  async probe(path: string): Promise<MediaProbeResult> {
    try {
      const { stderr } = await this.exec(resolveFfmpegPath(), ["-hide_banner", "-i", path, "-f", "null", "-"]);
      return parseMetadata(path, stderr);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`media probe failed for ${path}:`)) throw error;
      const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
      const reason = stderr || (error instanceof Error ? error.message : String(error));
      throw new Error(`media probe failed for ${path}: ${reason}`);
    }
  }
}

function parseMetadata(path: string, stderr: string): MediaProbeResult {
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!duration) throw new Error(`media probe failed for ${path}: no duration found`);
  const [, hours = "0", minutes = "0", seconds = "0"] = duration;
  const durationMs = (Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)) * 1000;
  return { durationMs: Math.round(durationMs), hasVideo: /Video:/.test(stderr), hasAudio: /Audio:/.test(stderr) };
}
