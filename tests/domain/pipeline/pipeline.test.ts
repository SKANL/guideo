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
