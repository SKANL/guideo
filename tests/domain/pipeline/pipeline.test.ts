import { describe, expect, it } from "vitest";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { Audio, FinalVideo, RawClip, Subtitle } from "../../../src/domain/models/media.js";
import type { NarrationSegment } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { render } from "../../../src/domain/pipeline/pipeline.js";
import { plan } from "../../../src/domain/pipeline/planning.js";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { FlowGraphRoutes, ScriptGen } from "../../../src/domain/ports/script-gen.js";
import type { Target } from "../../../src/domain/ports/target.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";
import { review } from "../../../src/domain/review-gate.js";

const graph = parseFlowGraph({
  nodes: [
    { id: "n1", feature: "invite", useCase: "invite a teammate", preconditions: [], selectors: {} },
  ],
  edges: [],
});

class FakeTarget implements Target {
  async discover() {
    return graph;
  }
}

class FakeScriptGen implements ScriptGen {
  async generate(_brief: unknown, _routes: FlowGraphRoutes) {
    return {
      script: parseScript({
        segments: [
          {
            id: "seg-1",
            text: "Let's invite a teammate.",
            timing: { startMs: 0, durationMs: 1500 },
          },
        ],
      }),
      storyboard: parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] }),
    };
  }
}

class FakeRecordingEngine implements RecordingEngine {
  captureCalls = 0;
  async capture(): Promise<RawClip> {
    this.captureCalls += 1;
    return { path: "clip.mp4", durationMs: 1500, aspectRatio: "16:9" };
  }
}

class FakeVoiceGen implements VoiceGen {
  synthesizeCalls = 0;
  async synthesize(segment: NarrationSegment): Promise<Audio> {
    this.synthesizeCalls += 1;
    return {
      segmentId: segment.id,
      path: `${segment.id}.mp3`,
      durationMs: segment.timing.durationMs,
    };
  }
}

class FakePlatformProfile implements PlatformProfile {
  composeCalls = 0;
  lastParams: ComposeParams | undefined;
  async compose(params: ComposeParams): Promise<FinalVideo> {
    this.composeCalls += 1;
    this.lastParams = params;
    return { path: "final.mp4", aspectRatio: params.rawClip.aspectRatio };
  }
}

describe("plan -> review -> render (end-to-end against fakes)", () => {
  it("produces a FinalVideo only after approval, wiring capture/synthesize/compose exactly once each", async () => {
    const target = new FakeTarget();
    const scriptGen = new FakeScriptGen();
    const engine = new FakeRecordingEngine();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const { script, storyboard } = await plan(target, brief, scriptGen);

    // No spend before approval.
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);

    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint an ApprovedStoryboard");

    const finalVideo = await render(approved, script, engine, voice, profile);

    expect(engine.captureCalls).toBe(1);
    expect(voice.synthesizeCalls).toBe(1);
    expect(profile.composeCalls).toBe(1);
    expect(finalVideo).toEqual({ path: "final.mp4", aspectRatio: "16:9" });

    const subtitles = profile.lastParams?.subtitles as Subtitle[];
    expect(subtitles).toEqual([{ text: "Let's invite a teammate.", startMs: 0, durationMs: 1500 }]);
  });

  // Regression (real e2e): ElevenLabs free tier allows only 2 concurrent requests; fanning out
  // every segment at once hit a 429. Voice synthesis must be serialized (never overlapping).
  it("synthesizes voice segments sequentially, never overlapping calls", async () => {
    const engine = new FakeRecordingEngine();
    const profile = new FakePlatformProfile();
    const script = parseScript({
      segments: [
        { id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } },
        { id: "s2", text: "Two.", timing: { startMs: 1000, durationMs: 1000 } },
        { id: "s3", text: "Three.", timing: { startMs: 2000, durationMs: 1000 } },
      ],
    });
    const storyboard = parseStoryboard({
      steps: [
        { action: "pause", narrationSegmentId: "s1" },
        { action: "pause", narrationSegmentId: "s2" },
        { action: "pause", narrationSegmentId: "s3" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    let inFlight = 0;
    let maxInFlight = 0;
    const voice: VoiceGen = {
      async synthesize(segment: NarrationSegment): Promise<Audio> {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { segmentId: segment.id, path: `${segment.id}.mp3`, durationMs: 1000 };
      },
    };

    await render(approved, script, engine, voice, profile);

    expect(maxInFlight).toBe(1);
  });

  it("never calls capture/synthesize when the storyboard is rejected", () => {
    const engine = new FakeRecordingEngine();
    const voice = new FakeVoiceGen();
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });

    const decision = review(storyboard, { kind: "rejected", reason: "off-brand" });

    expect(decision).toBeNull();
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
  });
});
