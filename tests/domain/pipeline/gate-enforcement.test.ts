import { describe, it } from "vitest";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { Audio, FinalVideo, RawClip } from "../../../src/domain/models/media.js";
import type { NarrationSegment, Script } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import type { ApprovedStoryboard } from "../../../src/domain/models/storyboard.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { render } from "../../../src/domain/pipeline/pipeline.js";
import { plan } from "../../../src/domain/pipeline/planning.js";
import type { EffectsEngine } from "../../../src/domain/ports/effects.js";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../../../src/domain/ports/preroll-trimmer.js";
import type { PrivacyCutResult, PrivacyCutter } from "../../../src/domain/ports/privacy-cutter.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { SceneAssembler } from "../../../src/domain/ports/scene-assembler.js";
import type { SceneClip, SceneSplitter } from "../../../src/domain/ports/scene-splitter.js";
import type { FlowGraphRoutes, ScriptGen } from "../../../src/domain/ports/script-gen.js";
import type { Target } from "../../../src/domain/ports/target.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";

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
  async capture(): Promise<RawClip> {
    return { path: "clip.mp4", durationMs: 1500, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
  }
}

class FakePreRollTrimmer implements PreRollTrimmer {
  async trim(clip: RawClip): Promise<RawClip> {
    return clip;
  }
}

class FakeEffectsEngine implements EffectsEngine {
  async apply(clip: RawClip): Promise<RawClip> {
    return clip;
  }
}

class FakePrivacyCutter implements PrivacyCutter {
  async cut(
    clip: RawClip,
    _storyboard: ApprovedStoryboard,
    script: Script,
    audioTracks: readonly Audio[],
  ): Promise<PrivacyCutResult> {
    return { clip, script, audioTracks };
  }
}

class FakeSceneSplitter implements SceneSplitter {
  async split(clip: RawClip): Promise<SceneClip[]> {
    return [{ narrationSegmentId: "", path: clip.path, durationMs: clip.durationMs }];
  }
}

class FakeSceneAssembler implements SceneAssembler {
  async assemble(sceneClips: readonly SceneClip[]): Promise<RawClip> {
    const only = sceneClips[0];
    return {
      path: only?.path ?? "",
      durationMs: only?.durationMs ?? 0,
      aspectRatio: "16:9",
      scenes: [],
      preRollMs: 0,
    };
  }
}

class FakeVoiceGen implements VoiceGen {
  async synthesize(segment: NarrationSegment): Promise<Audio> {
    return {
      segmentId: segment.id,
      path: `${segment.id}.mp3`,
      durationMs: segment.timing.durationMs,
    };
  }
}

class FakePlatformProfile implements PlatformProfile {
  async compose(params: ComposeParams): Promise<FinalVideo> {
    return { path: "final.mp4", aspectRatio: params.rawClip.aspectRatio };
  }
}

describe("gate enforcement: render() rejects plan()'s raw output at compile time", () => {
  it("does not typecheck when render() is called with plan()'s unapproved Storyboard", async () => {
    const target = new FakeTarget();
    const scriptGen = new FakeScriptGen();
    const engine = new FakeRecordingEngine();
    const preRollTrimmer = new FakePreRollTrimmer();
    const privacyCutter = new FakePrivacyCutter();
    const effectsEngine = new FakeEffectsEngine();
    const sceneSplitter = new FakeSceneSplitter();
    const sceneAssembler = new FakeSceneAssembler();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const { script, storyboard } = await plan(target, brief, scriptGen);

    // @ts-expect-error - render() requires ApprovedStoryboard; plan()'s Storyboard has not been
    // through ReviewGate.review() and cannot be minted here. This is the compile-time proof that
    // render(plan(...).storyboard) is unreachable without going through the REVIEW gate.
    void render(
      storyboard,
      script,
      engine,
      preRollTrimmer,
      privacyCutter,
      effectsEngine,
      sceneSplitter,
      sceneAssembler,
      voice,
      profile,
    );
  });
});
