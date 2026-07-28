import { describe, expect, it } from "vitest";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { Audio, FinalVideo, RawClip, Subtitle } from "../../../src/domain/models/media.js";
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
    return { path: "clip.mp4", durationMs: 1500, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
  }
}

class FakePreRollTrimmer implements PreRollTrimmer {
  trimCalls = 0;
  lastArgs: { clip: RawClip; preRollMs: number } | undefined;
  async trim(clip: RawClip, preRollMs: number): Promise<RawClip> {
    this.trimCalls += 1;
    this.lastArgs = { clip, preRollMs };
    return { ...clip, path: `trimmed-${clip.path}`, preRollMs: 0 };
  }
}

class FakeEffectsEngine implements EffectsEngine {
  applyCalls = 0;
  lastArgs: { clip: RawClip; storyboard: ApprovedStoryboard } | undefined;
  async apply(clip: RawClip, storyboard: ApprovedStoryboard): Promise<RawClip> {
    this.applyCalls += 1;
    this.lastArgs = { clip, storyboard };
    return { ...clip, path: `edited-${clip.path}` };
  }
}

// Passthrough by default (no scene is private in most tests below) — mirrors the real
// FfmpegPrivacyCutter's no-op behavior.
class FakePrivacyCutter implements PrivacyCutter {
  cutCalls = 0;
  lastArgs: { clip: RawClip; storyboard: ApprovedStoryboard; script: Script } | undefined;
  async cut(
    clip: RawClip,
    storyboard: ApprovedStoryboard,
    script: Script,
    audioTracks: readonly Audio[],
  ): Promise<PrivacyCutResult> {
    this.cutCalls += 1;
    this.lastArgs = { clip, storyboard, script };
    return { clip, script, audioTracks };
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
    const preRollTrimmer = new FakePreRollTrimmer();
    const effectsEngine = new FakeEffectsEngine();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const { script, storyboard } = await plan(target, brief, scriptGen);

    // No spend before approval.
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);

    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint an ApprovedStoryboard");

    const finalVideo = await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      new FakePrivacyCutter(),
      effectsEngine,
      voice,
      profile,
      "final.mp4",
    );

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
    const preRollTrimmer = new FakePreRollTrimmer();
    const effectsEngine = new FakeEffectsEngine();
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

    await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      new FakePrivacyCutter(),
      effectsEngine,
      voice,
      profile,
      "final.mp4",
    );

    expect(maxInFlight).toBe(1);
  });

  // Regression (real e2e): capture paced itself independent of narration, producing a 21s video
  // against a 43s script. Voice must fully finish BEFORE capture starts, and capture must receive
  // each segment's synthesized audio duration so it can pace scenes to match narration length.
  it("synthesizes voice fully before capture starts, passing capture the per-segment target durations", async () => {
    const events: string[] = [];
    let receivedDurations: ReadonlyMap<string, number> | undefined;

    const script = parseScript({
      segments: [
        { id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } },
        { id: "s2", text: "Two.", timing: { startMs: 1000, durationMs: 2000 } },
      ],
    });
    const storyboard = parseStoryboard({
      steps: [
        { action: "pause", narrationSegmentId: "s1" },
        { action: "pause", narrationSegmentId: "s2" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const voice: VoiceGen = {
      async synthesize(segment: NarrationSegment): Promise<Audio> {
        events.push(`voice:${segment.id}`);
        return {
          segmentId: segment.id,
          path: `${segment.id}.mp3`,
          durationMs: segment.timing.durationMs,
        };
      },
    };
    const engine: RecordingEngine = {
      async capture(
        _approved,
        segmentDurationsMs: ReadonlyMap<string, number> = new Map(),
      ): Promise<RawClip> {
        events.push("capture:start");
        receivedDurations = segmentDurationsMs;
        return {
          path: "clip.mp4",
          durationMs: 3000,
          aspectRatio: "16:9",
          scenes: [],
          preRollMs: 0,
        };
      },
    };
    const preRollTrimmer = new FakePreRollTrimmer();
    const effectsEngine = new FakeEffectsEngine();
    const profile = new FakePlatformProfile();

    await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      new FakePrivacyCutter(),
      effectsEngine,
      voice,
      profile,
      "final.mp4",
    );

    expect(events).toEqual(["voice:s1", "voice:s2", "capture:start"]);
    expect(receivedDurations).toEqual(
      new Map([
        ["s1", 1000],
        ["s2", 2000],
      ]),
    );
  });

  // New Edit stage (design doc section B): voice -> capture -> edit -> subtitles -> compose.
  // effectsEngine.apply() must run between capture and compose, receiving the storyboard, and
  // compose must receive the EDITED clip it returns (not the raw captured one).
  it("calls the effects engine between capture and compose, and compose receives the edited clip", async () => {
    const script = parseScript({
      segments: [{ id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } }],
    });
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "s1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const events: string[] = [];
    const engine: RecordingEngine = {
      async capture(): Promise<RawClip> {
        events.push("capture");
        return { path: "raw.mp4", durationMs: 1000, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
      },
    };
    const preRollTrimmer: PreRollTrimmer = {
      async trim(clip: RawClip): Promise<RawClip> {
        events.push("trim");
        return clip;
      },
    };
    const effectsEngine: EffectsEngine = {
      async apply(clip: RawClip, sb: ApprovedStoryboard): Promise<RawClip> {
        events.push("edit");
        expect(clip.path).toBe("raw.mp4");
        expect(sb).toBe(approved);
        return { ...clip, path: "edited.mp4" };
      },
    };
    const voice: VoiceGen = {
      async synthesize(segment: NarrationSegment): Promise<Audio> {
        return { segmentId: segment.id, path: `${segment.id}.mp3`, durationMs: 1000 };
      },
    };
    const profile = new FakePlatformProfile();

    await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      new FakePrivacyCutter(),
      effectsEngine,
      voice,
      profile,
      "final.mp4",
    );

    expect(events).toEqual(["capture", "trim", "edit"]);
    expect(profile.composeCalls).toBe(1);
    expect(profile.lastParams?.rawClip.path).toBe("edited.mp4");
  });

  // Privacy + alignment fix (design doc section C, sub-project 5a): the pre-roll trim must run
  // BEFORE effects (whose scene ranges are 0-based, matching the TRIMMED clip), and must receive
  // capture()'s real preRollMs. Gated by a `trimPreRoll` render option, default true.
  it("trims the clip's real preRollMs before effects run, passing effects the trimmed clip", async () => {
    const script = parseScript({
      segments: [{ id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } }],
    });
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "s1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const engine: RecordingEngine = {
      async capture(): Promise<RawClip> {
        return {
          path: "raw.mp4",
          durationMs: 1000,
          aspectRatio: "16:9",
          scenes: [],
          preRollMs: 750,
        };
      },
    };
    const preRollTrimmer = new FakePreRollTrimmer();
    const effectsEngine: EffectsEngine = {
      async apply(clip: RawClip): Promise<RawClip> {
        expect(clip.path).toBe("trimmed-raw.mp4");
        expect(clip.preRollMs).toBe(0);
        return clip;
      },
    };
    const voice: VoiceGen = {
      async synthesize(segment: NarrationSegment): Promise<Audio> {
        return { segmentId: segment.id, path: `${segment.id}.mp3`, durationMs: 1000 };
      },
    };
    const profile = new FakePlatformProfile();

    await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      new FakePrivacyCutter(),
      effectsEngine,
      voice,
      profile,
      "final.mp4",
    );

    expect(preRollTrimmer.trimCalls).toBe(1);
    expect(preRollTrimmer.lastArgs?.preRollMs).toBe(750);
    expect(preRollTrimmer.lastArgs?.clip.path).toBe("raw.mp4");
  });

  it("skips the pre-roll trim when trimPreRoll is false, passing the raw clip straight to effects", async () => {
    const script = parseScript({
      segments: [{ id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } }],
    });
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "s1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const engine: RecordingEngine = {
      async capture(): Promise<RawClip> {
        return {
          path: "raw.mp4",
          durationMs: 1000,
          aspectRatio: "16:9",
          scenes: [],
          preRollMs: 750,
        };
      },
    };
    const preRollTrimmer = new FakePreRollTrimmer();
    const effectsEngine: EffectsEngine = {
      async apply(clip: RawClip): Promise<RawClip> {
        expect(clip.path).toBe("raw.mp4");
        expect(clip.preRollMs).toBe(750);
        return clip;
      },
    };
    const voice: VoiceGen = {
      async synthesize(segment: NarrationSegment): Promise<Audio> {
        return { segmentId: segment.id, path: `${segment.id}.mp3`, durationMs: 1000 };
      },
    };
    const profile = new FakePlatformProfile();

    await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      new FakePrivacyCutter(),
      effectsEngine,
      voice,
      profile,
      "final.mp4",
      { trimPreRoll: false },
    );

    expect(preRollTrimmer.trimCalls).toBe(0);
  });

  // Privacy cut (design doc section C, sub-project 5b): the cut stage must run between the
  // pre-roll trim and effects, and be a fast passthrough (no extra ffmpeg call, i.e. the fake's
  // `cut` still runs but returns the SAME clip/script/audioTracks it was given) when no scene is
  // private — the common case.
  it("runs the privacy cut stage between trim and effects; it's a passthrough when nothing is private", async () => {
    const script = parseScript({
      segments: [{ id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } }],
    });
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "s1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const events: string[] = [];
    const engine: RecordingEngine = {
      async capture(): Promise<RawClip> {
        events.push("capture");
        return { path: "raw.mp4", durationMs: 1000, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
      },
    };
    const preRollTrimmer: PreRollTrimmer = {
      async trim(clip: RawClip): Promise<RawClip> {
        events.push("trim");
        return clip;
      },
    };
    const privacyCutter: PrivacyCutter = {
      async cut(
        clip: RawClip,
        _storyboard: ApprovedStoryboard,
        script: Script,
        audioTracks: readonly Audio[],
      ): Promise<PrivacyCutResult> {
        events.push("privacy-cut");
        expect(clip.path).toBe("raw.mp4");
        return { clip, script, audioTracks };
      },
    };
    const effectsEngine: EffectsEngine = {
      async apply(clip: RawClip, sb: ApprovedStoryboard): Promise<RawClip> {
        events.push("edit");
        expect(clip.path).toBe("raw.mp4");
        expect(sb).toBe(approved);
        return { ...clip, path: "edited.mp4" };
      },
    };
    const voice: VoiceGen = {
      async synthesize(segment: NarrationSegment): Promise<Audio> {
        return { segmentId: segment.id, path: `${segment.id}.mp3`, durationMs: 1000 };
      },
    };
    const profile = new FakePlatformProfile();

    await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      privacyCutter,
      effectsEngine,
      voice,
      profile,
      "final.mp4",
    );

    expect(events).toEqual(["capture", "trim", "privacy-cut", "edit"]);
    expect(profile.composeCalls).toBe(1);
    expect(profile.lastParams?.rawClip.path).toBe("edited.mp4");
  });

  // When a scene IS private, compose must receive the CUT clip/audioTracks (not the ones capture
  // produced) and subtitles derived from the cut+rebased script.
  it("when a scene is private, compose receives the cut clip, cut audioTracks, and re-derived subtitles", async () => {
    const script = parseScript({
      segments: [
        { id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } },
        { id: "s2", text: "Two (secret).", timing: { startMs: 1000, durationMs: 1000 } },
      ],
    });
    const storyboard = parseStoryboard({
      steps: [
        { action: "pause", narrationSegmentId: "s1" },
        { action: "pause", narrationSegmentId: "s2", visibility: "private" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const engine: RecordingEngine = {
      async capture(): Promise<RawClip> {
        return {
          path: "raw.mp4",
          durationMs: 2000,
          aspectRatio: "16:9",
          scenes: [
            { narrationSegmentId: "s1", startMs: 0, endMs: 1000 },
            { narrationSegmentId: "s2", startMs: 1000, endMs: 2000 },
          ],
          preRollMs: 0,
        };
      },
    };
    const preRollTrimmer: PreRollTrimmer = {
      async trim(clip: RawClip): Promise<RawClip> {
        return clip;
      },
    };
    const cutScript: Script = {
      segments: [{ id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1000 } }],
    };
    const cutAudioTracks: Audio[] = [{ segmentId: "s1", path: "s1.mp3", durationMs: 1000 }];
    const privacyCutter: PrivacyCutter = {
      cutCalls: 0,
      async cut(clip: RawClip): Promise<PrivacyCutResult> {
        this.cutCalls += 1;
        return {
          clip: {
            ...clip,
            path: "cut.mp4",
            scenes: [{ narrationSegmentId: "s1", startMs: 0, endMs: 1000 }],
          },
          script: cutScript,
          audioTracks: cutAudioTracks,
        };
      },
    } as PrivacyCutter & { cutCalls: number };
    const effectsEngine: EffectsEngine = {
      async apply(clip: RawClip): Promise<RawClip> {
        expect(clip.path).toBe("cut.mp4");
        return { ...clip, path: "edited.mp4" };
      },
    };
    const voice: VoiceGen = {
      async synthesize(segment: NarrationSegment): Promise<Audio> {
        return { segmentId: segment.id, path: `${segment.id}.mp3`, durationMs: 1000 };
      },
    };
    const profile = new FakePlatformProfile();

    await render(
      approved,
      script,
      engine,
      preRollTrimmer,
      privacyCutter,
      effectsEngine,
      voice,
      profile,
      "final.mp4",
    );

    expect(profile.lastParams?.rawClip.path).toBe("edited.mp4");
    expect(profile.lastParams?.audioTracks).toBe(cutAudioTracks);
    expect(profile.lastParams?.subtitles).toEqual([{ text: "One.", startMs: 0, durationMs: 1000 }]);
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
