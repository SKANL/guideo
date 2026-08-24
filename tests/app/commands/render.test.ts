import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElevenLabsVoice } from "../../../src/adapters/voice/elevenlabs-voice.js";
import { runRender } from "../../../src/app/commands/render.js";
import { projectPaths } from "../../../src/app/paths.js";
import { approvalManifest } from "../../../src/domain/artifacts/manifest.js";
import { sha256 } from "../../../src/domain/artifacts/canonical.js";
import type { Audio, FinalVideo, RawClip } from "../../../src/domain/models/media.js";
import type { NarrationSegment, Script } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import type { ApprovedStoryboard } from "../../../src/domain/models/storyboard.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { EffectsEngine } from "../../../src/domain/ports/effects.js";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../../../src/domain/ports/preroll-trimmer.js";
import type { PrivacyCutResult, PrivacyCutter } from "../../../src/domain/ports/privacy-cutter.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { SceneAssembler } from "../../../src/domain/ports/scene-assembler.js";
import type { SceneClip, SceneSplitter } from "../../../src/domain/ports/scene-splitter.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";
import type { MediaProbe, MediaProbeResult } from "../../../src/domain/ports/media-probe.js";
import type { UsageActual, UsageLedger, UsageSnapshot, Reservation, BudgetRequest } from "../../../src/domain/ports/usage-ledger.js";
import type { ArtifactManifest, ArtifactRef } from "../../../src/domain/artifacts/manifest.js";
import type { ArtifactStore } from "../../../src/domain/ports/artifact-store.js";

const script = parseScript({
  segments: [
    { id: "seg-1", text: "Let's invite a teammate.", timing: { startMs: 0, durationMs: 1500 } },
  ],
});
const storyboard = parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });

class FakeRecordingEngine implements RecordingEngine {
  captureCalls = 0;
  async capture(): Promise<RawClip> {
    this.captureCalls += 1;
    return { path: "clip.mp4", durationMs: 1500, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
  }
}

class FakePreRollTrimmer implements PreRollTrimmer {
  trimCalls = 0;
  async trim(clip: RawClip): Promise<RawClip> {
    this.trimCalls += 1;
    return clip;
  }
}

class FakeEffectsEngine implements EffectsEngine {
  applyCalls = 0;
  async applyToScenes(
    _clip: RawClip,
    sceneClips: readonly SceneClip[],
    _storyboard: ApprovedStoryboard,
  ): Promise<SceneClip[]> {
    this.applyCalls += 1;
    return [...sceneClips];
  }
}

class FakePrivacyCutter implements PrivacyCutter {
  cutCalls = 0;
  async cut(
    clip: RawClip,
    _storyboard: ApprovedStoryboard,
    script: Script,
    audioTracks: readonly Audio[],
  ): Promise<PrivacyCutResult> {
    this.cutCalls += 1;
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

class FakeMediaProbe implements MediaProbe {
  constructor(private readonly result: MediaProbeResult) {}
  async probe(): Promise<MediaProbeResult> { return this.result; }
}

class FakePlatformProfile implements PlatformProfile {
  composeCalls = 0;
  lastParams: ComposeParams | undefined;
  async compose(params: ComposeParams): Promise<FinalVideo> {
    this.composeCalls += 1;
    this.lastParams = params;
    await mkdir(dirname(params.outputPath), { recursive: true });
    await writeFile(params.outputPath, "video", "utf8");
    return { path: params.outputPath, aspectRatio: params.rawClip.aspectRatio };
  }
}

class TrackingArtifactStore implements ArtifactStore {
  finalized: ArtifactManifest[] = [];
  quarantined: string[] = [];
  async lookup(): Promise<ArtifactRef | null> { return null; }
  async finalize(input: AsyncIterable<Uint8Array>, manifest: Omit<ArtifactManifest, "sha256">): Promise<ArtifactRef> {
    for await (const _chunk of input) { /* consume the final bytes */ }
    const ref = { schema: manifest.schema, version: manifest.version, sha256: "finalized", inputs: manifest.inputs };
    this.finalized.push({ ...manifest, ...ref });
    return ref;
  }
  async quarantine(runId: string): Promise<void> { this.quarantined.push(runId); }
}

let scratchDir: string | undefined;

async function writeApprovedFixtures(paths: ReturnType<typeof projectPaths>): Promise<void> {
  await mkdir(paths.guideoDir, { recursive: true });
  const graph = { nodes: [], edges: [] };
  await writeFile(paths.scriptPath, JSON.stringify(script), "utf8");
  await writeFile(paths.storyboardPath, JSON.stringify(storyboard), "utf8");
  await writeFile(paths.flowGraphPath, JSON.stringify(graph), "utf8");
  await writeFile(paths.approvalManifestPath, JSON.stringify({ ...approvalManifest({ flowGraph: sha256(graph), script: sha256(script), storyboard: sha256(storyboard), policy: sha256({ version: 2 }) }), finalized: true }), "utf8");
}

class TrackingLedger implements UsageLedger {
  commits = 0;
  releases = 0;
  voiceReservations = 0;
  async reserve(request: BudgetRequest): Promise<Reservation> { if (request.operation === "voice") this.voiceReservations += 1; return { id: `${request.operation}-1`, request }; }
  async commit(_id: string, _actual: UsageActual): Promise<void> { this.commits += 1; }
  async release(_id: string, _reason: string): Promise<void> { this.releases += 1; }
  async snapshot(): Promise<UsageSnapshot> { return { spent: 0, reserved: 0 }; }
}

class RejectingLedger implements UsageLedger {
  async reserve(_request: BudgetRequest): Promise<Reservation> { throw new Error("budget exceeded before external call"); }
  async commit(_id: string, _actual: UsageActual): Promise<void> {}
  async release(_id: string, _reason: string): Promise<void> {}
  async snapshot(): Promise<UsageSnapshot> { return { spent: 0, reserved: 0 }; }
}

class CommitFailingLedger implements UsageLedger {
  commits = 0;
  releases = 0;
  async reserve(request: BudgetRequest): Promise<Reservation> { return { id: `${request.operation}-1`, request }; }
  async commit(_id: string, _actual: UsageActual): Promise<void> { this.commits += 1; throw new Error("ledger commit failed"); }
  async release(_id: string, _reason: string): Promise<void> { this.releases += 1; }
  async snapshot(): Promise<UsageSnapshot> { return { spent: 0, reserved: 0 }; }
}

afterEach(async () => {
  if (scratchDir) {
    await rm(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("runRender", () => {
  it("refuses without --approve and never calls capture/synthesize/compose (no spend)", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const engine = new FakeRecordingEngine();
    const preRollTrimmer = new FakePreRollTrimmer();
    const privacyCutter = new FakePrivacyCutter();
    const effectsEngine = new FakeEffectsEngine();
    const sceneSplitter = new FakeSceneSplitter();
    const sceneAssembler = new FakeSceneAssembler();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();

    await expect(
      runRender(
        {
          recordingEngine: engine,
          preRollTrimmer,
          privacyCutter,
          effectsEngine,
          sceneSplitter,
          sceneAssembler,
          voiceGen: voice,
          platformProfile: profile,
        },
        false,
        paths,
      ),
    ).rejects.toThrow(/--approve/);

    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
    expect(profile.composeCalls).toBe(0);
  });

  it("with --approve, mints the ApprovedStoryboard and renders exactly once through each adapter", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const engine = new FakeRecordingEngine();
    const preRollTrimmer = new FakePreRollTrimmer();
    const privacyCutter = new FakePrivacyCutter();
    const effectsEngine = new FakeEffectsEngine();
    const sceneSplitter = new FakeSceneSplitter();
    const sceneAssembler = new FakeSceneAssembler();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();

    const video = await runRender(
      {
        recordingEngine: engine,
        preRollTrimmer,
        privacyCutter,
        effectsEngine,
        sceneSplitter,
        sceneAssembler,
        voiceGen: voice,
        platformProfile: profile,
      },
      true,
      paths,
    );

    expect(video).toEqual({ path: paths.outputPath, aspectRatio: "16:9" });
    expect(engine.captureCalls).toBe(1);
    expect(effectsEngine.applyCalls).toBe(1);
    expect(voice.synthesizeCalls).toBe(1);
    expect(profile.composeCalls).toBe(1);
    expect(profile.lastParams?.outputPath).not.toBe(paths.outputPath);
    expect(profile.lastParams?.outputPath).toMatch(/\.mp4$/);
  });

  it("finalizes the MP4 provenance before atomically exposing its required SRT sidecar", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const store = new TrackingArtifactStore();

    const video = await runRender({ recordingEngine: new FakeRecordingEngine(), preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: new FakeVoiceGen(), platformProfile: new FakePlatformProfile(), artifactStore: store }, true, paths, "silent");

    expect(store.finalized).toHaveLength(1);
    expect(store.finalized[0]).toMatchObject({ schema: "guideo.final-video", finalized: true });
    expect(video.provenance?.sha256).toBe("finalized");
    expect(await readFile(paths.outputPath, "utf8")).toBe("video");
    expect(await readFile(paths.captionsPath, "utf8")).toContain("Let's invite a teammate.");
  });

  it("removes the promoted MP4 when captions promotion fails, preventing partial delivery", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    await mkdir(paths.captionsPath, { recursive: true });

    await expect(runRender({ recordingEngine: new FakeRecordingEngine(), preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: new FakeVoiceGen(), platformProfile: new FakePlatformProfile() }, true, paths, "silent")).rejects.toThrow();

    await expect(stat(paths.outputPath)).rejects.toThrow();
  });

  it("requires an existing finalized approval manifest and never issues one", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    await unlink(paths.approvalManifestPath);
    const engine = new FakeRecordingEngine();
    await expect(runRender({ recordingEngine: engine, preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: new FakeVoiceGen(), platformProfile: new FakePlatformProfile() }, true, paths)).rejects.toThrow(/finalized approval manifest/i);
    expect(engine.captureCalls).toBe(0);
  });

  it("stops before any external adapter when the render budget cannot be reserved", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const engine = new FakeRecordingEngine();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();
    await expect(runRender({ recordingEngine: engine, preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: voice, platformProfile: profile, usageLedger: new RejectingLedger() }, true, paths)).rejects.toThrow("budget");
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
    expect(profile.composeCalls).toBe(0);
  });


  it("blocks delivery with actionable quality failures before committing the render reservation", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const ledger = new TrackingLedger();
    const profile = new FakePlatformProfile();

    await expect(runRender({ recordingEngine: new FakeRecordingEngine(), preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: new FakeVoiceGen(), platformProfile: profile, mediaProbe: new FakeMediaProbe({ durationMs: 500, hasVideo: false, hasAudio: true }), usageLedger: ledger }, true, paths, "silent")).rejects.toThrow(/output has no video stream.*shorter than planned.*silent output must not contain an audio stream/s);

    expect(ledger.commits).toBe(0);
    expect(ledger.releases).toBe(0);
    await expect(stat(profile.lastParams!.outputPath)).rejects.toThrow();
    await expect(readFile(paths.captionsPath, "utf8")).rejects.toThrow();
  });

  it("retains an external-work reservation when the render ledger commit fails", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const ledger = new CommitFailingLedger();
    const profile = new FakePlatformProfile();

    await expect(runRender({ recordingEngine: new FakeRecordingEngine(), preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: new FakeVoiceGen(), platformProfile: profile, mediaProbe: new FakeMediaProbe({ durationMs: 1500, hasVideo: true, hasAudio: false }), usageLedger: ledger }, true, paths, "silent")).rejects.toThrow("ledger commit failed");

    expect(ledger.commits).toBe(1);
    expect(ledger.releases).toBe(0);
    await expect(stat(profile.lastParams!.outputPath)).rejects.toThrow();
    await expect(readFile(paths.captionsPath, "utf8")).rejects.toThrow();
  });

  it("renders silent output without VoiceGen quota and writes an accessible captions sidecar", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const voice = new FakeVoiceGen();
    const ledger = new TrackingLedger();

    await runRender({ recordingEngine: new FakeRecordingEngine(), preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: voice, platformProfile: new FakePlatformProfile(), mediaProbe: new FakeMediaProbe({ durationMs: 1500, hasVideo: true, hasAudio: false }), usageLedger: ledger }, true, paths, "silent");

    expect(voice.synthesizeCalls).toBe(0);
    expect(await readFile(paths.captionsPath, "utf8")).toContain("Let's invite a teammate.");
    expect(ledger.voiceReservations).toBe(0);
  });

  it("writes an accessible captions sidecar for voiced output too", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);

    await runRender({ recordingEngine: new FakeRecordingEngine(), preRollTrimmer: new FakePreRollTrimmer(), privacyCutter: new FakePrivacyCutter(), effectsEngine: new FakeEffectsEngine(), sceneSplitter: new FakeSceneSplitter(), sceneAssembler: new FakeSceneAssembler(), voiceGen: new FakeVoiceGen(), platformProfile: new FakePlatformProfile() }, true, paths, "voice");

    expect(await readFile(paths.captionsPath, "utf8")).toContain("Let's invite a teammate.");
  });

  describe("missing ELEVENLABS_API_KEY", () => {
    const originalKey = process.env.ELEVENLABS_API_KEY;

    beforeEach(() => {
      delete process.env.ELEVENLABS_API_KEY;
    });

    afterEach(() => {
      if (originalKey === undefined) {
        delete process.env.ELEVENLABS_API_KEY;
      } else {
        process.env.ELEVENLABS_API_KEY = originalKey;
      }
    });

    it("surfaces a clear error instead of failing silently when render needs voice synthesis and no key is set", async () => {
      scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
      const paths = projectPaths({ project: "test-project", cwd: scratchDir });
      await writeApprovedFixtures(paths);
      const engine = new FakeRecordingEngine();
      const preRollTrimmer = new FakePreRollTrimmer();
      const privacyCutter = new FakePrivacyCutter();
      const effectsEngine = new FakeEffectsEngine();
      const sceneSplitter = new FakeSceneSplitter();
      const sceneAssembler = new FakeSceneAssembler();
      const profile = new FakePlatformProfile();
      // Real ElevenLabsVoice, no injected client, no env key: throws before any network call.
      const voice = new ElevenLabsVoice();

      await expect(
        runRender(
          {
            recordingEngine: engine,
            preRollTrimmer,
            privacyCutter,
            effectsEngine,
            sceneSplitter,
            sceneAssembler,
            voiceGen: voice,
            platformProfile: profile,
          },
          true,
          paths,
        ),
      ).rejects.toThrow(/ELEVENLABS_API_KEY/);
    });
  });
});
