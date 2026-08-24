import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ElevenLabsSdkClient,
  ElevenLabsTextToSpeechRequest,
} from "../../../src/adapters/voice/elevenlabs-voice.js";
import { ElevenLabsVoice } from "../../../src/adapters/voice/elevenlabs-voice.js";
import { parseScript } from "../../../src/domain/models/script.js";

const script = parseScript({
  segments: [{ id: "seg-1", text: "Let's log in.", timing: { startMs: 0, durationMs: 1500 } }],
});
const segment = script.segments[0];
if (!segment) throw new Error("expected a segment");

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fakeClient(
  convert: (
    voiceId: string,
    request: ElevenLabsTextToSpeechRequest,
  ) => Promise<ReadableStream<Uint8Array>>,
): ElevenLabsSdkClient {
  return { textToSpeech: { convert } };
}

describe("ElevenLabsVoice", () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ELEVENLABS_API_KEY;
    } else {
      process.env.ELEVENLABS_API_KEY = originalKey;
    }
    delete process.env.GUIDEO_VOICE_ID;
  });

  it("lets GUIDEO_VOICE_ID env override the configured voice (per-account free-tier voice access)", async () => {
    process.env.GUIDEO_VOICE_ID = "env-voice-id";
    const convert = vi.fn(async () => bytesToStream(new Uint8Array(0)));
    const voice = new ElevenLabsVoice(fakeClient(convert), { voiceId: "calibration-voice" });

    await voice.synthesize(segment);

    expect(convert).toHaveBeenCalledWith("env-voice-id", expect.anything());
  });

  it("maps a script segment to a synthesis call and assembles the Audio result", async () => {
    // mp3_44100_128 => 16000 bytes/sec; 8000 bytes => 500ms.
    const bytes = new Uint8Array(8000);
    const convert = vi.fn(async () => bytesToStream(bytes));
    const voice = new ElevenLabsVoice(fakeClient(convert));

    const audio = await voice.synthesize(segment);

    expect(convert).toHaveBeenCalledTimes(1);
    expect(audio.segmentId).toBe("seg-1");
    expect(audio.durationMs).toBe(500);
    expect(audio.path.endsWith(".mp3")).toBe(true);
  });

  it("reports the real character-priced provider cost as a cache miss", async () => {
    const voice = new ElevenLabsVoice(fakeClient(async () => bytesToStream(new Uint8Array(0))), {
      costPerCharacterMicros: 3,
    });

    const result = await voice.synthesizeWithUsage(segment);

    expect(result.usage).toMatchObject({
      unit: "usd-micros",
      amount: segment.text.length * 3,
      cache: "miss",
      provider: "elevenlabs",
    });
  });

  it("preserves provider word timing and complete audio provenance when the provider exposes alignment", async () => {
    const voice = new ElevenLabsVoice({
      textToSpeech: {
        convert: async () => bytesToStream(new Uint8Array(0)),
        convertWithTimestamps: async () => ({
          audio: bytesToStream(new Uint8Array([1, 2, 3])),
          alignment: {
            characters: ["G", "o", " ", "n", "o", "w"],
            characterStartTimesSeconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
            characterEndTimesSeconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
          },
        }),
      },
    }, { voiceId: "voice-1", modelId: "model-1", seed: 7, costPerCharacterMicros: 3 });

    const result = await voice.synthesizeWithUsage({ id: "seg-1", text: "Go now", timing: { startMs: 1_000, durationMs: 900 } });

    expect(result.audio.speech).toEqual({
      approximate: false,
      words: [
        { text: "Go", startMs: 1_000, endMs: 1_200 },
        { text: "now", startMs: 1_300, endMs: 1_600 },
      ],
    });
    expect(result.audio.provenance).toMatchObject({
      audioSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      provider: "elevenlabs",
      model: "model-1",
      voiceId: "voice-1",
      seed: 7,
      measuredCost: { unit: "usd-micros", amount: 18, cache: "miss" },
    });
  });

  it("marks deterministic timing as approximate when provider alignment is unavailable", async () => {
    const voice = new ElevenLabsVoice(fakeClient(async () => bytesToStream(new Uint8Array(0))));

    const audio = await voice.synthesize({ id: "seg-1", text: "Go now", timing: { startMs: 0, durationMs: 900 } });

    expect(audio.speech).toEqual({
      approximate: true,
      words: [
        { text: "Go", startMs: 0, endMs: 450 },
        { text: "now", startMs: 450, endMs: 900 },
      ],
    });
  });

  it("propagates the configured voice/model/calibration knobs to the client call", async () => {
    const convert = vi.fn(async () => bytesToStream(new Uint8Array(0)));
    const voice = new ElevenLabsVoice(fakeClient(convert), {
      voiceId: "custom-voice",
      modelId: "eleven_turbo_v2",
      outputFormat: "mp3_22050_32",
      stability: 0.1,
      similarityBoost: 0.9,
      style: 0.6,
      useSpeakerBoost: false,
      speed: 1.2,
    });

    await voice.synthesize(segment);

    expect(convert).toHaveBeenCalledWith("custom-voice", {
      text: segment.text,
      modelId: "eleven_turbo_v2",
      outputFormat: "mp3_22050_32",
      voiceSettings: {
        stability: 0.1,
        similarityBoost: 0.9,
        style: 0.6,
        useSpeakerBoost: false,
        speed: 1.2,
      },
    });
  });

  it("surfaces a clear error when synthesis fails, instead of silently returning empty audio", async () => {
    const convert = vi.fn(async () => {
      throw new Error("upstream 500");
    });
    const voice = new ElevenLabsVoice(fakeClient(convert));

    await expect(voice.synthesize(segment)).rejects.toThrow(/seg-1/);
    await expect(voice.synthesize(segment)).rejects.toThrow(/upstream 500/);
  });

  it("does not require ELEVENLABS_API_KEY at construction/import time", () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => new ElevenLabsVoice()).not.toThrow();
  });

  it("produces a clear error only when synthesize is attempted without ELEVENLABS_API_KEY set", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const voice = new ElevenLabsVoice();

    await expect(voice.synthesize(segment)).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });

  describe("with a stubbed environment", () => {
    beforeEach(() => {
      process.env.ELEVENLABS_API_KEY = "test-key";
    });

    it("builds a default client from the injected key when none is provided", () => {
      // No assertion beyond "does not throw at construction" — the real client is only ever
      // created lazily inside synthesize(), never here.
      expect(() => new ElevenLabsVoice()).not.toThrow();
    });
  });
});
