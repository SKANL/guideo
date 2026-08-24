// Composition root's construction step: builds exactly one real adapter per port (per spec's
// plugin-seams requirement). Every adapter constructor here is lazy — no env read, no browser/
// SDK/network I/O at construction time (see each adapter's own doc comment) — so createContainer()
// is always safe to call, even before any env is loaded (e.g. for `guideo --help`).
import {
  ClaudeAgentScriptGen,
  ElevenLabsVoice,
  FfmpegEffectsEngine,
  FfmpegMediaProbe,
  FfmpegPreRollTrimmer,
  FfmpegPrivacyCutter,
  FfmpegSceneAssembler,
  FfmpegSceneSplitter,
  UrlCredsTarget,
  WebRecordingEngine,
  YouTubeProfile,
} from "../adapters/index.js";
import type { EffectsEngine } from "../domain/ports/effects.js";
import type { PlatformProfile } from "../domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../domain/ports/preroll-trimmer.js";
import type { PrivacyCutter } from "../domain/ports/privacy-cutter.js";
import type { RecordingEngine } from "../domain/ports/recording-engine.js";
import type { SceneAssembler } from "../domain/ports/scene-assembler.js";
import type { SceneSplitter } from "../domain/ports/scene-splitter.js";
import type { ScriptGen } from "../domain/ports/script-gen.js";
import type { Target } from "../domain/ports/target.js";
import type { VoiceGen } from "../domain/ports/voice-gen.js";
import type { MediaProbe } from "../domain/ports/media-probe.js";
import type { UsageLedger } from "../domain/ports/usage-ledger.js";
import { FileUsageLedger } from "../adapters/usage/file-usage-ledger.js";
import { FileCaptureCheckpointStore } from "../adapters/recording/file-capture-checkpoint-store.js";
import { FsArtifactStore } from "../adapters/storage/fs-artifact-store.js";
import type { ArtifactStore } from "../domain/ports/artifact-store.js";
import { join } from "node:path";

const DEFAULT_USAGE_LIMIT = 600_000;

function usageLimitFromEnv(value = process.env.GUIDEO_USAGE_LIMIT): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USAGE_LIMIT;
}

export interface Container {
  readonly target: Target;
  readonly scriptGen: ScriptGen;
  readonly recordingEngine: RecordingEngine;
  readonly preRollTrimmer: PreRollTrimmer;
  readonly privacyCutter: PrivacyCutter;
  readonly effectsEngine: EffectsEngine;
  readonly sceneSplitter: SceneSplitter;
  readonly sceneAssembler: SceneAssembler;
  readonly voiceGen: VoiceGen;
  readonly platformProfile: PlatformProfile;
  readonly mediaProbe?: MediaProbe;
  readonly artifactStore?: ArtifactStore;
  readonly usageLedger?: UsageLedger;
}

// Every field is independently overridable (tests inject fakes for one or more ports; the rest
// fall back to the real adapter).
export function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    target: overrides.target ?? new UrlCredsTarget(),
    scriptGen: overrides.scriptGen ?? new ClaudeAgentScriptGen(),
    recordingEngine: overrides.recordingEngine ?? new WebRecordingEngine(undefined, undefined, undefined, undefined, undefined, undefined, undefined, new FileCaptureCheckpointStore(join(process.cwd(), ".guideo", "capture-checkpoints"))),
    preRollTrimmer: overrides.preRollTrimmer ?? new FfmpegPreRollTrimmer(),
    privacyCutter: overrides.privacyCutter ?? new FfmpegPrivacyCutter(),
    effectsEngine: overrides.effectsEngine ?? new FfmpegEffectsEngine(),
    sceneSplitter: overrides.sceneSplitter ?? new FfmpegSceneSplitter(),
    sceneAssembler: overrides.sceneAssembler ?? new FfmpegSceneAssembler(),
    voiceGen: overrides.voiceGen ?? new ElevenLabsVoice(),
    platformProfile: overrides.platformProfile ?? new YouTubeProfile(),
    mediaProbe: overrides.mediaProbe ?? new FfmpegMediaProbe(),
    artifactStore: overrides.artifactStore ?? new FsArtifactStore(join(process.cwd(), ".guideo", "artifacts")),
    usageLedger: overrides.usageLedger ?? new FileUsageLedger(join(process.cwd(), ".guideo", "usage.json"), { limit: usageLimitFromEnv() }),
  };
}
