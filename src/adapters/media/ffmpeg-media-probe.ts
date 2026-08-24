import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { MediaProbe, MediaProbeResult } from "../../domain/ports/media-probe.js";

const execFile = promisify(execFileCallback);

export interface FfmpegProbeExecResult {
  readonly stderr?: string;
  readonly stdout?: string;
}

export type FfmpegProbeExec = (ffmpegPath: string, argv: readonly string[]) => Promise<FfmpegProbeExecResult>;

async function defaultExec(binary: string, argv: readonly string[]): Promise<FfmpegProbeExecResult> {
  const result = await execFile(binary, [...argv]);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

export class FfmpegMediaProbe implements MediaProbe {
  constructor(private readonly exec: FfmpegProbeExec = defaultExec) {}

  async probe(path: string): Promise<MediaProbeResult> {
    try {
      const argv = ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", path];
      const result = await this.exec("ffprobe", argv);
      return parseMetadata(path, result.stdout ?? result.stderr ?? "", argv);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`media probe failed for ${path}:`)) throw error;
      const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
      const reason = stderr || (error instanceof Error ? error.message : String(error));
      throw new Error(`media probe failed for ${path}: ${reason}`);
    }
  }
}

function parseMetadata(path: string, output: string, argv: readonly string[]): MediaProbeResult {
  try {
    const parsed = JSON.parse(output) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }> };
    const durationMs = Math.round(Number(parsed.format?.duration) * 1000);
    if (!Number.isFinite(durationMs)) throw new Error("no duration found");
    const streams = parsed.streams ?? [];
    const video = streams.filter((stream) => stream.codec_type === "video");
    const audio = streams.filter((stream) => stream.codec_type === "audio");
    const subtitles = streams.filter((stream) => stream.codec_type === "subtitle");
    return { durationMs, hasVideo: video.length > 0, hasAudio: audio.length > 0, ...(video[0]?.codec_name ? { videoCodec: video[0].codec_name } : {}), ...(audio[0]?.codec_name ? { audioCodec: audio[0].codec_name } : {}), ...(video[0]?.width !== undefined ? { width: video[0].width } : {}), ...(video[0]?.height !== undefined ? { height: video[0].height } : {}), videoStreams: video.length, audioStreams: audio.length, subtitleStreams: subtitles.length, evidence: { command: "ffprobe", path, argv } };
  } catch (error) {
    if (error instanceof SyntaxError) { /* Support the legacy injected ffmpeg stderr fake. */ } else if (error instanceof Error && error.message === "no duration found") throw new Error(`media probe failed for ${path}: no duration found`);
  }
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  if (!duration) throw new Error(`media probe failed for ${path}: no duration found`);
  const [, hours = "0", minutes = "0", seconds = "0"] = duration;
  const durationMs = (Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)) * 1000;
  const video = /Video:\s*([^,\s\\]+)/.exec(output)?.[1];
  const audio = /Audio:\s*([^,\s\\]+)/.exec(output)?.[1];
  return { durationMs: Math.round(durationMs), hasVideo: video !== undefined, hasAudio: audio !== undefined, ...(video ? { videoCodec: video } : {}), ...(audio ? { audioCodec: audio } : {}), videoStreams: video ? 1 : 0, audioStreams: audio ? 1 : 0, subtitleStreams: /Subtitle:/.test(output) ? 1 : 0, evidence: { command: "ffprobe", path, argv } };
}
