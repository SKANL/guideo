import type { RenderProfileName } from "../../domain/models/media.js";
import type { NarrationMode } from "../../domain/models/narration-mode.js";
import type { MediaProbe, MediaProbeResult } from "../../domain/ports/media-probe.js";
import { physicalRenderValidationScenario } from "./physical-render-matrix.js";

export interface FrameCheckpoint {
  readonly atMs: number;
  readonly bytes: number;
}
export interface FrameCheckpointProbe {
  capture(videoPath: string, checkpointsMs: readonly number[]): Promise<readonly FrameCheckpoint[]>;
}
export interface PhysicalRenderValidationRequest {
  readonly videoPath: string;
  readonly srtPath: string;
  readonly profile: RenderProfileName;
  readonly narration: NarrationMode;
  readonly plannedDurationMs: number;
  readonly checkpointsMs: readonly number[];
}
export interface PhysicalRenderValidatorDependencies {
  readonly request: PhysicalRenderValidationRequest;
  readonly mediaProbe: MediaProbe;
  readonly frameProbe: FrameCheckpointProbe;
  readonly readText: (path: string) => Promise<string>;
}
type DirectInput = {
  readonly videoPath: string;
  readonly captions: string;
  readonly profile: RenderProfileName;
  readonly narration: NarrationMode;
  readonly mediaProbe: MediaProbe;
  readonly frameProbe: {
    extract(
      videoPath: string,
      checkpointsMs: readonly number[],
    ): Promise<readonly { atMs: number; bytes: Uint8Array }[]>;
  };
  readonly checkpointsMs: readonly number[];
};
export interface PhysicalRenderValidationResult {
  readonly ok: boolean;
  readonly status: "passed" | "failed";
  readonly failures: readonly string[];
  readonly metadata: MediaProbeResult;
  readonly checkpoints: readonly unknown[];
}
const SRT_CUE = /^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}\r?\n.+/m;

/** Validates completed MP4/SRT bytes and decodable frames independently of quality evaluation. */
export async function validatePhysicalRender(
  input: PhysicalRenderValidatorDependencies | DirectInput,
): Promise<PhysicalRenderValidationResult> {
  const nested = "request" in input;
  const request: PhysicalRenderValidationRequest | DirectInput = nested ? input.request : input;
  const [metadata, captions, rawFrames] = await Promise.all([
    input.mediaProbe.probe(request.videoPath),
    nested ? input.readText(input.request.srtPath) : Promise.resolve(input.captions),
    nested
      ? input.frameProbe.capture(request.videoPath, request.checkpointsMs)
      : input.frameProbe.extract(request.videoPath, request.checkpointsMs),
  ]);
  const frames = rawFrames.map((frame) => ({
    atMs: frame.atMs,
    bytes: typeof frame.bytes === "number" ? frame.bytes : frame.bytes.byteLength,
  }));
  const failures: string[] = [];
  const scenario = physicalRenderValidationScenario(request.profile, request.narration);
  if (!metadata.hasVideo) failures.push("MP4 has no video stream");
  if (metadata.videoCodec !== undefined && metadata.videoCodec !== "h264")
    failures.push(`MP4 video codec must be h264, received ${metadata.videoCodec}`);
  if (
    scenario !== undefined &&
    (metadata.width !== scenario.width || metadata.height !== scenario.height)
  ) {
    failures.push(
      `MP4 dimensions must be ${scenario.width}×${scenario.height}, received ${metadata.width ?? "unknown"}×${metadata.height ?? "unknown"}`,
    );
    failures.push(
      `${request.profile} output must be ${scenario.width}x${scenario.height}; received ${metadata.width ?? "unknown"}x${metadata.height ?? "unknown"}`,
    );
  }
  if (nested && metadata.durationMs < input.request.plannedDurationMs)
    failures.push(
      `MP4 duration ${metadata.durationMs}ms is shorter than planned ${input.request.plannedDurationMs}ms`,
    );
  const audioRequired =
    scenario?.hasAudio ?? (request.narration === "voice" || request.narration === "both");
  if (metadata.hasAudio !== audioRequired) {
    if (audioRequired) failures.push("narration mode requires an audio stream");
    else {
      failures.push("silent narration mode must not contain an audio stream");
      failures.push(`${request.narration} output must not contain an audio stream`);
    }
  }
  if (captions.trim().length === 0) failures.push("captions sidecar is empty");
  if (!SRT_CUE.test(captions.trim())) {
    failures.push("SRT sidecar has no valid caption cue");
    failures.push("captions sidecar has no valid SRT cue");
  }
  const captured = new Map(frames.map((frame) => [frame.atMs, frame.bytes]));
  for (const checkpoint of request.checkpointsMs) {
    const bytes = captured.get(checkpoint);
    if (bytes === undefined) {
      failures.push(`frame checkpoint ${checkpoint}ms was not captured`);
      failures.push(`frame checkpoint ${checkpoint}ms was not returned`);
    } else if (bytes === 0) failures.push(`frame checkpoint ${checkpoint}ms is empty`);
  }
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    metadata,
    checkpoints: nested ? [...request.checkpointsMs] : rawFrames,
  };
}
