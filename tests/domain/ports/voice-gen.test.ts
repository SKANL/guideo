import { describe, expect, it } from "vitest";
import type { Audio } from "../../../src/domain/models/media.js";
import { parseScript } from "../../../src/domain/models/script.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";

const script = parseScript({
  segments: [{ id: "seg-1", text: "Let's log in.", timing: { startMs: 0, durationMs: 1500 } }],
});

class FakeVoiceGen implements VoiceGen {
  async synthesize(segment: (typeof script)["segments"][number]): Promise<Audio> {
    return {
      segmentId: segment.id,
      path: `${segment.id}.mp3`,
      durationMs: segment.timing.durationMs,
    };
  }
}

describe("VoiceGen port", () => {
  it("synthesizes one Audio track per Script segment", async () => {
    const voiceGen: VoiceGen = new FakeVoiceGen();
    const segment = script.segments[0];
    if (!segment) throw new Error("expected a segment");
    const audio = await voiceGen.synthesize(segment);
    expect(audio.segmentId).toBe("seg-1");
    expect(audio.durationMs).toBe(1500);
  });
});
