import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsArtifactStore } from "../../../src/adapters/storage/fs-artifact-store.js";
import type { Audio, FinalVideo, RawClip } from "../../../src/domain/models/media.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard, type ApprovedStoryboard } from "../../../src/domain/models/storyboard.js";
import { render, renderWithContext } from "../../../src/domain/pipeline/pipeline.js";
import { SceneArtifactCache } from "../../../src/domain/pipeline/scene-artifact-cache.js";
import { review } from "../../../src/domain/review-gate.js";
import type { EffectsEngine } from "../../../src/domain/ports/effects.js";
import type { PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../../../src/domain/ports/preroll-trimmer.js";
import type { PrivacyCutter } from "../../../src/domain/ports/privacy-cutter.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { SceneAssembler } from "../../../src/domain/ports/scene-assembler.js";
import type { SceneClip, SceneSplitter } from "../../../src/domain/ports/scene-splitter.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";

const script = parseScript({
  segments: [
    { id: "s1", text: "One.", timing: { startMs: 0, durationMs: 1_000 } },
    { id: "s2", text: "Two.", timing: { startMs: 1_000, durationMs: 1_000 } },
  ],
});
const storyboard = parseStoryboard({ steps: [
  { action: "pause", narrationSegmentId: "s1", effects: [{ type: "zoom-in", params: { amount: 1.1 } }] },
  { action: "pause", narrationSegmentId: "s2" },
] });
const approved = review(storyboard, { kind: "approved" });
if (approved === null) throw new Error("expected approval");

class Recording implements RecordingEngine { async capture(): Promise<RawClip> { return { path: "raw.mp4", durationMs: 2_000, aspectRatio: "16:9", scenes: [], preRollMs: 0 }; } }
class Trim implements PreRollTrimmer { async trim(clip: RawClip): Promise<RawClip> { return clip; } }
class Privacy implements PrivacyCutter { async cut(clip: RawClip, _approved: ApprovedStoryboard, currentScript: typeof script, audioTracks: readonly Audio[]) { return { clip, script: currentScript, audioTracks }; } }
class Split implements SceneSplitter { constructor(private readonly scenes: readonly SceneClip[]) {} async split(): Promise<SceneClip[]> { return [...this.scenes]; } }
class Assemble implements SceneAssembler { assembled: SceneClip[][] = []; async assemble(scenes: readonly SceneClip[]): Promise<RawClip> { this.assembled.push([...scenes]); return { path: scenes.map((scene) => scene.path).join(","), durationMs: 2_000, aspectRatio: "16:9", scenes: [], preRollMs: 0 }; } }
class Effects implements EffectsEngine { batches: string[][] = []; async applyToScenes(_clip: RawClip, scenes: readonly SceneClip[]): Promise<SceneClip[]> { this.batches.push(scenes.map((scene) => scene.path)); return scenes.map((scene) => ({ ...scene, path: `edited-${scene.path}` })); } }
class Voice implements VoiceGen { async synthesize(): Promise<Audio> { throw new Error("silent renders must not synthesize voice"); } }
class Compose implements PlatformProfile { async compose(params: { rawClip: RawClip }): Promise<FinalVideo> { return { path: params.rawClip.path, aspectRatio: "16:9" }; } }

function ports(cache: SceneArtifactCache, effects: Effects, assembler: Assemble, scenes: readonly SceneClip[]) {
  return { recordingEngine: new Recording(), preRollTrimmer: new Trim(), privacyCutter: new Privacy(), effectsEngine: effects, sceneSplitter: new Split(scenes), sceneAssembler: assembler, voiceGen: new Voice(), platformProfile: new Compose(), sceneArtifactCache: cache };
}

describe("incremental scene artifact cache", () => {
  it("does not repeat the effects external call for an exact cached scene", async () => {
    const cache = new SceneArtifactCache(); const effects = new Effects(); const assembler = new Assemble();
    const scenes = [{ narrationSegmentId: "s1", path: "s1-v1.mp4", durationMs: 1_000 }];
    await render(ports(cache, effects, assembler, scenes), approved, script, "one.mp4", { narration: "silent" });
    await render(ports(cache, effects, assembler, scenes), approved, script, "two.mp4", { narration: "silent" });
    expect(effects.batches).toEqual([["s1-v1.mp4"]]);
    expect(assembler.assembled.at(-1)).toEqual([{ narrationSegmentId: "s1", path: "edited-s1-v1.mp4", durationMs: 1_000 }]);
  });

  it("reprocesses only the dirty scene and reuses the unaffected artifact in composition", async () => {
    const cache = new SceneArtifactCache(); const effects = new Effects(); const assembler = new Assemble();
    await render(ports(cache, effects, assembler, [{ narrationSegmentId: "s1", path: "s1-v1.mp4", durationMs: 1_000 }, { narrationSegmentId: "s2", path: "s2-v1.mp4", durationMs: 1_000 }]), approved, script, "one.mp4", { narration: "silent" });
    await render(ports(cache, effects, assembler, [{ narrationSegmentId: "s1", path: "s1-v2.mp4", durationMs: 1_000 }, { narrationSegmentId: "s2", path: "s2-v1.mp4", durationMs: 1_000 }]), approved, script, "two.mp4", { narration: "silent" });
    expect(effects.batches).toEqual([["s1-v1.mp4", "s2-v1.mp4"], ["s1-v2.mp4"]]);
    expect(assembler.assembled.at(-1)).toEqual([{ narrationSegmentId: "s1", path: "edited-s1-v2.mp4", durationMs: 1_000 }, { narrationSegmentId: "s2", path: "edited-s2-v1.mp4", durationMs: 1_000 }]);
  });

  it("rehydrates persisted artifacts across independent cache instances without repeating effects", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-scene-cache-"));
    try {
      const scenes = [{ narrationSegmentId: "s1", path: "s1-v1.mp4", durationMs: 1_000 }];
      const effects = new Effects();
      await render(ports(new SceneArtifactCache(new FsArtifactStore(root)), effects, new Assemble(), scenes), approved, script, "one.mp4", { narration: "silent" });
      const assembler = new Assemble();
      await render(ports(new SceneArtifactCache(new FsArtifactStore(root)), effects, assembler, scenes), approved, script, "two.mp4", { narration: "silent" });

      expect(effects.batches).toEqual([["s1-v1.mp4"]]);
      expect(assembler.assembled.at(-1)).toEqual([{ narrationSegmentId: "s1", path: "edited-s1-v1.mp4", durationMs: 1_000 }]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("invalidates a persisted scene artifact when the input scene changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-scene-cache-"));
    try {
      const effects = new Effects();
      await render(ports(new SceneArtifactCache(new FsArtifactStore(root)), effects, new Assemble(), [{ narrationSegmentId: "s1", path: "s1-v1.mp4", durationMs: 1_000 }]), approved, script, "one.mp4", { narration: "silent" });
      await render(ports(new SceneArtifactCache(new FsArtifactStore(root)), effects, new Assemble(), [{ narrationSegmentId: "s1", path: "s1-v2.mp4", durationMs: 1_000 }]), approved, script, "two.mp4", { narration: "silent" });

      expect(effects.batches).toEqual([["s1-v1.mp4"], ["s1-v2.mp4"]]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reuses exact voice, capture, effects, and compose artifacts and records every stage timing", async () => {
    class CountingRecording extends Recording { calls = 0; override async capture(): Promise<RawClip> { this.calls += 1; return super.capture(); } }
    class CountingVoice implements VoiceGen { calls = 0; async synthesize(segment: { id: string; timing: { durationMs: number } }): Promise<Audio> { this.calls += 1; return { segmentId: segment.id, path: `${segment.id}.mp3`, durationMs: segment.timing.durationMs }; } }
    class CountingCompose implements PlatformProfile { calls = 0; async compose(params: Parameters<PlatformProfile["compose"]>[0]): Promise<FinalVideo> { this.calls += 1; await writeFile(params.outputPath, "video"); return { path: params.outputPath, aspectRatio: "16:9" }; } }
    const root = await mkdtemp(join(tmpdir(), "guideo-compose-cache-"));
    try {
      const cache = new SceneArtifactCache(); const effects = new Effects(); const assembler = new Assemble();
      const recording = new CountingRecording(); const voice = new CountingVoice(); const compose = new CountingCompose();
      const cachedPorts = { ...ports(cache, effects, assembler, [{ narrationSegmentId: "s1", path: "s1-v1.mp4", durationMs: 1_000 }]), recordingEngine: recording, voiceGen: voice, platformProfile: compose };
      const outputPath = join(root, "same.mp4");

      const first = await renderWithContext(cachedPorts, approved, script, outputPath);
      await renderWithContext(cachedPorts, approved, script, outputPath);

      expect(voice.calls).toBe(script.segments.length);
      expect(recording.calls).toBe(1);
      expect(effects.batches).toEqual([["s1-v1.mp4"]]);
      expect(compose.calls).toBe(1);
      expect(Object.keys(first.stageTimings)).toEqual(expect.arrayContaining(["synthesize-voice", "capture", "effects", "compose"]));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("recomposes when a cached final video has been removed", async () => {
    class MaterializingCompose implements PlatformProfile {
      calls = 0;
      async compose(params: Parameters<PlatformProfile["compose"]>[0]): Promise<FinalVideo> {
        this.calls += 1;
        await writeFile(params.outputPath, "video");
        return { path: params.outputPath, aspectRatio: "16:9" };
      }
    }
    const root = await mkdtemp(join(tmpdir(), "guideo-compose-cache-"));
    try {
      const cache = new SceneArtifactCache(); const effects = new Effects(); const assembler = new Assemble();
      const compose = new MaterializingCompose();
      const cachedPorts = {
        ...ports(cache, effects, assembler, [{ narrationSegmentId: "s1", path: "s1-v1.mp4", durationMs: 1_000 }]),
        platformProfile: compose,
      };
      const outputPath = join(root, "final.mp4");

      await render(cachedPorts, approved, script, outputPath, { narration: "silent" });
      await rm(outputPath);
      const rebuilt = await render(cachedPorts, approved, script, outputPath, { narration: "silent" });

      expect(compose.calls).toBe(2);
      expect(rebuilt.path).toBe(outputPath);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
