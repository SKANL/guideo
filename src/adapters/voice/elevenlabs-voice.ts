// ElevenLabsVoice — VoiceGen adapter, narration synthesis via the official ElevenLabs SDK.
//
// DI: the SDK client is injected (constructor param), never imported/constructed at module load
// or class-construction time. Unit tests pass a fake ElevenLabsSdkClient — no network, no real
// key. Only when synthesize() actually needs a client and none was injected does this adapter
// lazily build a real one from process.env.ELEVENLABS_API_KEY (loaded via `node --env-file`,
// per design), throwing a clear error if the key is missing — never at import time.

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { Audio } from "../../domain/models/media.js";
import type { NarrationSegment } from "../../domain/models/script.js";
import type { VoiceGen } from "../../domain/ports/voice-gen.js";
import type { UsageResult } from "../../domain/ports/usage-ledger.js";
import type { UsageEstimate } from "../../domain/ports/usage-ledger.js";
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
    convertWithTimestamps?(
      voiceId: string,
      request: ElevenLabsTextToSpeechRequest,
    ): Promise<unknown>;
  };
  readonly voices?: {
    get(voiceId: string): Promise<{ readonly voiceId?: unknown; readonly voice_id?: unknown }>;
  };
}

export interface ElevenLabsAlignment {
  readonly characters: readonly string[];
  readonly characterStartTimesSeconds: readonly number[];
  readonly characterEndTimesSeconds: readonly number[];
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
    return (await this.synthesizeResult(segment)).audio;
  }

  /**
   * Verifies the selected voice through the already-configured client before render reserves
   * budget or starts browser capture. The provider lookup does not synthesize audio.
   */
  async preflight(): Promise<void> {
    const voiceId = this.voiceId();
    this.assertConfiguration(voiceId);
    const client = this.injectedClient ?? this.getOrCreateDefaultClient();
    if (!client.voices?.get) {
      throw new Error("ElevenLabs preflight cannot verify the configured voice: the client does not expose voices.get(). Update @elevenlabs/elevenlabs-js or provide a compatible client.");
    }
    try {
      const response = await client.voices.get(voiceId);
      const responseVoiceId = typeof response?.voiceId === "string"
        ? response.voiceId
        : typeof response?.voice_id === "string"
          ? response.voice_id
          : undefined;
      if (responseVoiceId !== voiceId) {
        throw new Error(`configured voice "${voiceId}" is not available to this ElevenLabs account`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("configured voice")) throw error;
      throw new Error(`ElevenLabs preflight failed for voice "${voiceId}": ${message}`);
    }
  }

  private async synthesizeResult(segment: NarrationSegment): Promise<{ audio: Audio; voiceId: string }> {
    const client = this.injectedClient ?? this.getOrCreateDefaultClient();
    const { modelId, outputFormat, stability, similarityBoost, style, useSpeakerBoost, speed } =
      this.calibration;
    // Per-account voice override — free ElevenLabs accounts differ in which voices they may use via
    // API, so let the environment pick one without a code/calibration change.
    const voiceId = this.voiceId();

    let stream: ReadableStream<Uint8Array>;
    let alignment: ElevenLabsAlignment | undefined;
    try {
      const request = {
        text: segment.text,
        modelId,
        outputFormat,
        voiceSettings: { stability, similarityBoost, style, useSpeakerBoost, speed },
      };
      if (client.textToSpeech.convertWithTimestamps) {
        const response = await client.textToSpeech.convertWithTimestamps(voiceId, request) as { readonly audio: ReadableStream<Uint8Array>; readonly alignment?: ElevenLabsAlignment };
        stream = response.audio;
        alignment = response.alignment;
      } else {
        stream = await client.textToSpeech.convert(voiceId, request);
      }
    } catch (error) {
      throw new Error(
        `ElevenLabs synthesis failed for segment "${segment.id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const bytes = await readAllBytes(stream);
    const workDir = await mkdtemp(join(tmpdir(), "guideo-voice-"));
    const path = join(workDir, `${segment.id}-${randomUUID()}.mp3`);
    await writeFile(path, bytes);

    const durationMs = estimateDurationMs(bytes.length, outputFormat, segment.timing.durationMs);
    const speech = alignment ? providerWords(alignment, segment.timing.startMs) : approximateWords(segment.text, segment.timing.startMs, segment.timing.durationMs);
    const audio: Audio = {
      segmentId: segment.id,
      path,
      durationMs,
      speech: { approximate: !alignment, words: speech },
      provenance: {
        audioSha256: createHash("sha256").update(bytes).digest("hex"), provider: "elevenlabs", model: modelId,
        voiceId, ...(this.calibration.seed === undefined ? {} : { seed: this.calibration.seed }),
        measuredCost: { unit: "usd-micros", amount: segment.text.length * this.calibration.costPerCharacterMicros, cache: "miss" },
      },
    };
    return { audio, voiceId };
  }

  async synthesizeWithUsage(segment: NarrationSegment): Promise<{ audio: Audio; usage: UsageResult }> {
    if (!Number.isSafeInteger(this.calibration.costPerCharacterMicros) || this.calibration.costPerCharacterMicros <= 0) {
      throw new Error("ElevenLabs provider-cost accounting requires a positive costPerCharacterMicros calibration");
    }
    const { audio } = await this.synthesizeResult(segment);
    return { audio, usage: { unit: "usd-micros", amount: segment.text.length * this.calibration.costPerCharacterMicros, cache: "miss", provider: "elevenlabs", model: this.calibration.modelId, characters: segment.text.length } };
  }

  estimateUsage(segment: NarrationSegment): UsageEstimate {
    return { unit: "usd-micros", amount: segment.text.length * this.calibration.costPerCharacterMicros };
  }

  private voiceId(): string {
    return process.env.GUIDEO_VOICE_ID || this.calibration.voiceId;
  }

  private assertConfiguration(voiceId: string): void {
    if (!voiceId.trim()) throw new Error("ElevenLabs preflight requires GUIDEO_VOICE_ID or a non-empty calibrated voiceId");
    if (!this.calibration.modelId.trim()) throw new Error("ElevenLabs preflight requires a non-empty modelId calibration");
    if (!this.calibration.outputFormat.trim()) throw new Error("ElevenLabs preflight requires a non-empty outputFormat calibration");
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
    this.defaultClient = new ElevenLabsClient({ apiKey }) as unknown as ElevenLabsSdkClient;
    return this.defaultClient;
  }
}

function approximateWords(text: string, startMs: number, durationMs: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const width = Math.floor(durationMs / Math.max(words.length, 1));
  return words.map((word, index) => ({ text: word, startMs: startMs + index * width, endMs: index === words.length - 1 ? startMs + durationMs : startMs + (index + 1) * width }));
}

function providerWords(alignment: ElevenLabsAlignment, offsetMs: number) {
  const words: { text: string; startMs: number; endMs: number }[] = [];
  let text = ""; let startMs = 0; let endMs = 0;
  const commit = () => { if (text) words.push({ text, startMs, endMs }); text = ""; };
  alignment.characters.forEach((character, index) => {
    const start = Math.round((alignment.characterStartTimesSeconds[index] ?? 0) * 1000) + offsetMs;
    const end = Math.round((alignment.characterEndTimesSeconds[index] ?? 0) * 1000) + offsetMs;
    if (/\s/.test(character)) { commit(); return; }
    if (!text) startMs = start;
    text += character; endMs = end;
  });
  commit();
  return words;
}
