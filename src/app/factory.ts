// Composition root's construction step: builds exactly one real adapter per port (per spec's
// plugin-seams requirement). Every adapter constructor here is lazy — no env read, no browser/
// SDK/network I/O at construction time (see each adapter's own doc comment) — so createContainer()
// is always safe to call, even before any env is loaded (e.g. for `guideo --help`).
import {
  ClaudeAgentScriptGen,
  ElevenLabsVoice,
  FfmpegEffectsEngine,
  FfmpegPreRollTrimmer,
  UrlCredsTarget,
  WebRecordingEngine,
  YouTubeProfile,
} from "../adapters/index.js";
import type { EffectsEngine } from "../domain/ports/effects.js";
import type { PlatformProfile } from "../domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../domain/ports/preroll-trimmer.js";
import type { RecordingEngine } from "../domain/ports/recording-engine.js";
import type { ScriptGen } from "../domain/ports/script-gen.js";
import type { Target } from "../domain/ports/target.js";
import type { VoiceGen } from "../domain/ports/voice-gen.js";

export interface Container {
  readonly target: Target;
  readonly scriptGen: ScriptGen;
  readonly recordingEngine: RecordingEngine;
  readonly preRollTrimmer: PreRollTrimmer;
  readonly effectsEngine: EffectsEngine;
  readonly voiceGen: VoiceGen;
  readonly platformProfile: PlatformProfile;
}

// Every field is independently overridable (tests inject fakes for one or more ports; the rest
// fall back to the real adapter).
export function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    target: overrides.target ?? new UrlCredsTarget(),
    scriptGen: overrides.scriptGen ?? new ClaudeAgentScriptGen(),
    recordingEngine: overrides.recordingEngine ?? new WebRecordingEngine(),
    preRollTrimmer: overrides.preRollTrimmer ?? new FfmpegPreRollTrimmer(),
    effectsEngine: overrides.effectsEngine ?? new FfmpegEffectsEngine(),
    voiceGen: overrides.voiceGen ?? new ElevenLabsVoice(),
    platformProfile: overrides.platformProfile ?? new YouTubeProfile(),
  };
}
