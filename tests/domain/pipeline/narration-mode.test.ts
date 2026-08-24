import { describe, expect, it } from "vitest";
import type { Audio, FinalVideo, RawClip, ResolvedEffect } from "../../../src/domain/models/media.js";
import type { NarrationSegment, Script } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import type { ApprovedStoryboard } from "../../../src/domain/models/storyboard.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { type RenderPorts, render } from "../../../src/domain/pipeline/pipeline.js";
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
  captureCalls = 0;
  lastSegmentDurationsMs: ReadonlyMap<string, number> | undefined;
  constructor(private readonly resolvedEffects?: readonly ResolvedEffect[]) {}
  async capture(
    _approved: ApprovedStoryboard,
    segmentDurationsMs: ReadonlyMap<string, number>,
  ): Promise<RawClip> {
    this.captureCalls += 1;
    this.lastSegmentDurationsMs = segmentDurationsMs;
    // Real capture paces the recorded scene to the target duration it was given (whether that
    // target came from the Script's planned timing or synthesized audio) — subtitle timing must
    // follow this ASSEMBLED real duration, not whatever target was originally passed to capture.
    const durationMs = segmentDurationsMs.get("seg-1") ?? 1500;
    return {
      path: "clip.mp4", durationMs, aspectRatio: "16:9", scenes: [], preRollMs: 0,
      ...(this.resolvedEffects ? { resolvedEffects: this.resolvedEffects } : {}),
    };
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
  async applyToScenes(_clip: RawClip, sceneClips: readonly SceneClip[]): Promise<SceneClip[]> {
    return [...sceneClips];
  }
}

class FakeSceneSplitter implements SceneSplitter {
  async split(clip: RawClip): Promise<SceneClip[]> {
    return [{ narrationSegmentId: "seg-1", path: clip.path, durationMs: clip.durationMs }];
  }
}

class FakeSceneAssembler implements SceneAssembler {
  async assemble(sceneClips: readonly SceneClip[]): Promise<RawClip> {
    const only = sceneClips[0] as SceneClip;
    return {
      path: only.path,
      durationMs: only.durationMs,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: only.narrationSegmentId, startMs: 0, endMs: only.durationMs }],
      preRollMs: 0,
    };
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

function makePorts(): {
  ports: RenderPorts;
  voice: FakeVoiceGen;
  profile: FakePlatformProfile;
  engine: FakeRecordingEngine;
} {
  const voice = new FakeVoiceGen();
  const profile = new FakePlatformProfile();
  const engine = new FakeRecordingEngine();
  return {
    ports: {
      recordingEngine: engine,
      preRollTrimmer: new FakePreRollTrimmer(),
      privacyCutter: new FakePrivacyCutter(),
      effectsEngine: new FakeEffectsEngine(),
      sceneSplitter: new FakeSceneSplitter(),
      sceneAssembler: new FakeSceneAssembler(),
      voiceGen: voice,
      platformProfile: profile,
    },
    voice,
    profile,
    engine,
  };
}

function makeApproved(): ApprovedStoryboard {
  const storyboard = parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });
  const approved = review(storyboard, { kind: "approved" });
  if (approved === null) throw new Error("expected approval");
  return approved;
}

const script = parseScript({
  segments: [{ id: "seg-1", text: "Let's log in.", timing: { startMs: 0, durationMs: 4200 } }],
});

describe("render() narration modes", () => {
  it('mode "subtitles": never synthesizes voice, paces capture off the script\'s planned timing, and composes a silent video with burned subtitles', async () => {
    const { ports, voice, profile, engine } = makePorts();

    await render(ports, makeApproved(), script, "final.mp4", { narration: "subtitles" });

    expect(voice.synthesizeCalls).toBe(0);
    expect(engine.lastSegmentDurationsMs?.get("seg-1")).toBe(4200);
    expect(profile.lastParams?.audioTracks).toEqual([]);
    expect(profile.lastParams?.narration).toBe("subtitles");
    expect(profile.lastParams?.subtitles).toEqual([
      { text: "Let's log in.", startMs: 0, durationMs: 4200 },
    ]);
  });

  it('mode "voice": synthesizes voice, mixes real audio, and produces no subtitles', async () => {
    const { ports, voice, profile, engine } = makePorts();

    await render(ports, makeApproved(), script, "final.mp4", { narration: "voice" });

    expect(voice.synthesizeCalls).toBe(1);
    expect(engine.lastSegmentDurationsMs?.get("seg-1")).toBe(4200);
    expect(profile.lastParams?.audioTracks).toEqual([
      { segmentId: "seg-1", path: "seg-1.mp3", durationMs: 4200 },
    ]);
    expect(profile.lastParams?.subtitles).toEqual([]);
    expect(profile.lastParams?.narration).toBe("voice");
  });

  it('mode "both" (default): synthesizes voice, mixes real audio, and derives subtitles too', async () => {
    const { ports, voice, profile } = makePorts();

    await render(ports, makeApproved(), script, "final.mp4");

    expect(voice.synthesizeCalls).toBe(1);
    expect(profile.lastParams?.audioTracks).toEqual([
      { segmentId: "seg-1", path: "seg-1.mp3", durationMs: 4200 },
    ]);
    expect(profile.lastParams?.subtitles).toEqual([
      { text: "Let's log in.", startMs: 0, durationMs: 4200 },
    ]);
    expect(profile.lastParams?.narration).toBe("both");
  });
});

  it('mode "silent": never synthesizes voice, emits no embedded captions, and still has deterministic scene timing', async () => {
    const { ports, voice, profile, engine } = makePorts();

    await render(ports, makeApproved(), script, "final.mp4", { narration: "silent" });

    expect(voice.synthesizeCalls).toBe(0);
    expect(engine.lastSegmentDurationsMs?.get("seg-1")).toBe(4200);
    expect(profile.lastParams?.audioTracks).toEqual([]);
    expect(profile.lastParams?.subtitles).toEqual([]);
    expect(profile.lastParams?.narration).toBe("silent");
  });

  it("moves captions above a lower-third capture-resolved UI target without changing the Subtitle port shape", async () => {
    const { ports, profile } = makePorts();
    const resolvedEffects: readonly ResolvedEffect[] = [
      { narrationSegmentId: "seg-1", type: "crop", region: { x: 0, y: 430, w: 1280, h: 290 } },
    ];

    await render({ ...ports, recordingEngine: new FakeRecordingEngine(resolvedEffects) }, makeApproved(), script, "final.mp4", { narration: "subtitles" });

    expect(profile.lastParams?.subtitles[0]).toMatchObject({ placement: "top" });
    expect(profile.lastParams?.subtitles[0]).toEqual({ text: "Let's log in.", startMs: 0, durationMs: 4200 });
  });
