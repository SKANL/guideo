// ElevenLabsVoice — VoiceGen adapter, narration synthesis via the official ElevenLabs SDK.
//
// DI: the SDK client is injected (constructor param), never imported/constructed at module load
// or class-construction time. Unit tests pass a fake ElevenLabsSdkClient — no network, no real
// key. Only when synthesize() actually needs a client and none was injected does this adapter
// lazily build a real one from process.env.ELEVENLABS_API_KEY (loaded via `node --env-file`,
// per design), throwing a clear error if the key is missing — never at import time.

import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { Audio } from "../../domain/models/media.js";
import type { NarrationSegment } from "../../domain/models/script.js";
import type { VoiceGen } from "../../domain/ports/voice-gen.js";
import { DEFAULT_VOICE_CALIBRATION, type VoiceCalibration } from "./elevenlabs-config.js";

export interface ElevenLabsVoiceSettings {
  readonly stability?: number;
  readonly similarityBoost?: number;
  readonly style?: number;
  readonly useSpeakerBoost?: boolean;
  readonly speed?: number;
}

export interface ElevenLabsTextToSpeechRequest {
  readonly text: string;
  readonly modelId?: string;
  readonly outputFormat?: string;
  readonly voiceSettings?: ElevenLabsVoiceSettings;
}

// Narrow structural subset of @elevenlabs/elevenlabs-js's ElevenLabsClient — only what this
// adapter calls. A real ElevenLabsClient instance satisfies this structurally (its
// textToSpeech.convert returns an HttpResponsePromise<ReadableStream<Uint8Array>>, which is
// itself a Promise subclass), and unit tests can pass a plain fake object literal instead — no
// SDK-shaped mock needed, no network, no real key.
export interface ElevenLabsSdkClient {
  readonly textToSpeech: {
    convert(
      voiceId: string,
      request: ElevenLabsTextToSpeechRequest,
    ): Promise<ReadableStream<Uint8Array>>;
  };
}

// mp3_<sampleRate>_<kbps> is the only output-format family this adapter can derive an exact
// duration from via byte-length math (CBR assumption). Other formats (pcm/ulaw/alaw, or a VBR
// mp3 rate string this pattern doesn't match) fall back to the Script's own planned segment
// duration — an estimate, not a measurement, but never a crash.
const MP3_CBR_FORMAT = /^mp3_\d+_(\d+)$/;

function estimateDurationMs(byteLength: number, outputFormat: string, fallbackMs: number): number {
  const match = MP3_CBR_FORMAT.exec(outputFormat);
  if (!match?.[1]) {
    return fallbackMs;
  }
  const bytesPerSecond = (Number(match[1]) * 1000) / 8;
  if (bytesPerSecond <= 0) {
    return fallbackMs;
  }
  return Math.round((byteLength / bytesPerSecond) * 1000);
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export class ElevenLabsVoice implements VoiceGen {
  private readonly injectedClient: ElevenLabsSdkClient | undefined;
  private readonly calibration: VoiceCalibration;
  private defaultClient: ElevenLabsSdkClient | undefined;

  constructor(client?: ElevenLabsSdkClient, calibration: Partial<VoiceCalibration> = {}) {
    this.injectedClient = client;
    this.calibration = { ...DEFAULT_VOICE_CALIBRATION, ...calibration };
  }

  async synthesize(segment: NarrationSegment): Promise<Audio> {
    const client = this.injectedClient ?? this.getOrCreateDefaultClient();
    const { modelId, outputFormat, stability, similarityBoost, style, useSpeakerBoost, speed } =
      this.calibration;
    // Per-account voice override — free ElevenLabs accounts differ in which voices they may use via
    // API, so let the environment pick one without a code/calibration change.
    const voiceId = process.env.GUIDEO_VOICE_ID || this.calibration.voiceId;

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await client.textToSpeech.convert(voiceId, {
        text: segment.text,
        modelId,
        outputFormat,
        voiceSettings: { stability, similarityBoost, style, useSpeakerBoost, speed },
      });
    } catch (error) {
      throw new Error(
        `ElevenLabs synthesis failed for segment "${segment.id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const bytes = await readAllBytes(stream);
    const workDir = await mkdtemp(join(tmpdir(), "guideo-voice-"));
    const path = join(workDir, `${segment.id}-${randomUUID()}.mp3`);
    await writeFile(path, bytes);

    return {
      segmentId: segment.id,
      path,
      durationMs: estimateDurationMs(bytes.length, outputFormat, segment.timing.durationMs),
    };
  }

  // Lazy: only reads env / constructs the real SDK client the first time synthesize() actually
  // needs one and none was injected. Never runs at import or construction time.
  private getOrCreateDefaultClient(): ElevenLabsSdkClient {
    if (this.defaultClient) {
      return this.defaultClient;
    }
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set. Load it via `node --env-file=.env` (or export it) before synthesizing.",
      );
    }
    this.defaultClient = new ElevenLabsClient({ apiKey });
    return this.defaultClient;
  }
}
