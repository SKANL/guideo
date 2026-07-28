import { describe, expect, it } from "vitest";
import type { Audio, FinalVideo, RawClip } from "../../../src/domain/models/media.js";
import type { NarrationSegment, Script } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import type { ApprovedStoryboard } from "../../../src/domain/models/storyboard.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import {
  defaultRenderStages,
  type PipelineStage,
  type RenderContext,
  type RenderPorts,
  render,
} from "../../../src/domain/pipeline/pipeline.js";
import type { EffectsEngine } from "../../../src/domain/ports/effects.js";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../../../src/domain/ports/preroll-trimmer.js";
import type { PrivacyCutResult, PrivacyCutter } from "../../../src/domain/ports/privacy-cutter.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { SceneAssembler } from "../../../src/domain/ports/scene-assembler.js";
import type { SceneClip, SceneSplitter } from "../../../src/domain/ports/scene-splitter.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";
import { review } from "../../../src/domain/review-gate.js";

class FakeRecordingEngine implements RecordingEngine {
  async capture(): Promise<RawClip> {
    return { path: "clip.mp4", durationMs: 1000, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
  }
}

class FakePreRollTrimmer implements PreRollTrimmer {
  async trim(clip: RawClip): Promise<RawClip> {
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

class FakeEffectsEngine implements EffectsEngine {
  async apply(clip: RawClip): Promise<RawClip> {
    return clip;
  }
}

class FakeSceneSplitter implements SceneSplitter {
  async split(clip: RawClip): Promise<SceneClip[]> {
    return [{ narrationSegmentId: "", path: clip.path, durationMs: clip.durationMs }];
  }
}

class FakeSceneAssembler implements SceneAssembler {
  async assemble(sceneClips: readonly SceneClip[]): Promise<RawClip> {
    const only = sceneClips[0] as SceneClip;
    return {
      path: only.path,
      durationMs: only.durationMs,
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

function makePorts(): RenderPorts {
  return {
    recordingEngine: new FakeRecordingEngine(),
    preRollTrimmer: new FakePreRollTrimmer(),
    privacyCutter: new FakePrivacyCutter(),
    effectsEngine: new FakeEffectsEngine(),
    sceneSplitter: new FakeSceneSplitter(),
    sceneAssembler: new FakeSceneAssembler(),
    voiceGen: new FakeVoiceGen(),
    platformProfile: new FakePlatformProfile(),
  };
}

function makeApproved(): ApprovedStoryboard {
  const storyboard = parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "s1" }] });
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

const script = parseScript({
  segments: [{ id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } }],
});

// A stage that only records that it ran (and when), then passes the context through unchanged.
function recordingStage(name: string, events: string[]): PipelineStage {
  return {
    name,
    async run(ctx: RenderContext): Promise<RenderContext> {
      events.push(name);
      return ctx;
    },
  };
}

describe("pipeline stage composition", () => {
  it("runs a custom stage list in declared order", async () => {
    const events: string[] = [];
    const finalVideo: FinalVideo = { path: "final.mp4", aspectRatio: "16:9" };
    const stages: PipelineStage[] = [
      recordingStage("first", events),
      recordingStage("second", events),
      {
        name: "terminal",
        async run(ctx: RenderContext): Promise<RenderContext> {
          events.push("terminal");
          return { ...ctx, finalVideo };
        },
      },
    ];

    const result = await render(makePorts(), makeApproved(), script, "final.mp4", {}, stages);

    expect(events).toEqual(["first", "second", "terminal"]);
    expect(result).toEqual(finalVideo);
  });

  it("lets a caller insert a custom stage at a specific position in the default list", async () => {
    const events: string[] = [];
    const defaultStages = defaultRenderStages(makePorts());
    const composeIndex = defaultStages.findIndex((stage) => stage.name === "compose");
    const stages = [
      ...defaultStages.slice(0, composeIndex),
      recordingStage("custom-inserted", events),
      ...defaultStages.slice(composeIndex),
    ];

    await render(makePorts(), makeApproved(), script, "final.mp4", {}, stages);

    expect(events).toEqual(["custom-inserted"]);
    const names = stages.map((stage) => stage.name);
    expect(names.at(-2)).toBe("custom-inserted");
    expect(names.at(-1)).toBe("compose");
  });

  it("builds the default stage list in the documented order", () => {
    const names = defaultRenderStages(makePorts()).map((stage) => stage.name);

    expect(names).toEqual([
      "synthesize-voice",
      "capture",
      "trim-preroll",
      "privacy-cut",
      "effects",
      "scene-split",
      "scene-assemble",
      "derive-subtitles",
      "compose",
    ]);
  });

  it("throws a clear error when the stage list never produces a FinalVideo", async () => {
    const stages: PipelineStage[] = [recordingStage("no-op", [])];

    await expect(
      render(makePorts(), makeApproved(), script, "final.mp4", {}, stages),
    ).rejects.toThrow(/FinalVideo/);
  });
});
