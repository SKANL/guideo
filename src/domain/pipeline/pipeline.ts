import type { Audio, FinalVideo } from "../models/media.js";
import type { Script } from "../models/script.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";
import type { EffectsEngine } from "../ports/effects.js";
import type { PlatformProfile } from "../ports/platform-profile.js";
import type { PreRollTrimmer } from "../ports/preroll-trimmer.js";
import type { PrivacyCutter } from "../ports/privacy-cutter.js";
import type { RecordingEngine } from "../ports/recording-engine.js";
import type { VoiceGen } from "../ports/voice-gen.js";
import { deriveSubtitles } from "./subtitles.js";

// trimPreRoll (privacy/alignment fix, design doc section C, sub-project 5a): whether to cut the
// login/overlay-dismiss footage recorded before scene 0 from the output. Defaults to true —
// credentials should never appear in the shown video, and effects/audio/subtitles are keyed to
// 0-based scene ranges that only line up once that footage is removed. A caller can opt OUT
// (e.g. for debugging capture) by passing { trimPreRoll: false }.
export interface RenderOptions {
  readonly trimPreRoll?: boolean;
}

// render() only accepts an ApprovedStoryboard — the compile-time REVIEW-gate hard stop realized
// at the type level: plan()'s raw { script, storyboard } cannot reach render() without first
// going through ReviewGate.review() (src/domain/review-gate.ts). Voice synthesizes FIRST, then
// capture() runs — narration-driven timing (real e2e: capture paced itself independent of
// narration, giving a 21s video against a 43s script). Each segment's synthesized Audio.durationMs
// becomes that segment's target on-screen time, so capture() can pace scenes to match. The voice
// segments themselves are synthesized SEQUENTIALLY — TTS providers cap concurrent requests
// (ElevenLabs free tier = 2; fanning out all segments at once hit a 429). The pre-roll trim stage
// then runs BEFORE effects (unless trimPreRoll is false) — capture()'s scenes[*] are 0-based
// relative to scene 0, so effects/subtitles/audio only land on the right frames once the
// login/overlay-dismiss footage ahead of scene 0 is cut. The PRIVACY CUT stage (design doc section
// C, sub-project 5b) then runs BEFORE effects too: it removes every scene the storyboard marks
// `visibility: "private"` — video, its narration Audio track, and its Script segment — and rebases
// every kept scene contiguous from 0. Effects need no separate "re-gating" here: they're applied
// AFTER the cut, against the (already rebased) clip's `scenes`, so private steps' effects are
// naturally skipped (no matching scene) and kept steps' effects gate to the rebased times for
// free. The Edit stage (design doc section B) then runs effectsEngine.apply() on the CUT clip
// BEFORE subtitles/compose, applying each step's AI-proposed effects time-gated to its scene
// range; compose() receives the EDITED clip, never the raw one. Subtitles are derived purely from
// the (possibly cut+rebased) Script's known text plus each kept segment's actual synthesized audio
// duration (no transcription, per spec).
export async function render(
  approved: ApprovedStoryboard,
  script: Script,
  engine: RecordingEngine,
  preRollTrimmer: PreRollTrimmer,
  privacyCutter: PrivacyCutter,
  effectsEngine: EffectsEngine,
  voice: VoiceGen,
  profile: PlatformProfile,
  outputPath: string,
  options: RenderOptions = {},
): Promise<FinalVideo> {
  const trimPreRoll = options.trimPreRoll ?? true;
  const audioTracks = await synthesizeSequentially(voice, script);
  const segmentDurationsMs = new Map(
    audioTracks.map((audio) => [audio.segmentId, audio.durationMs]),
  );
  const rawClip = await engine.capture(approved, segmentDurationsMs);
  const trimmedClip = trimPreRoll ? await preRollTrimmer.trim(rawClip, rawClip.preRollMs) : rawClip;
  const cutResult = await privacyCutter.cut(trimmedClip, approved, script, audioTracks);
  const editedClip = await effectsEngine.apply(cutResult.clip, approved);
  const subtitles = deriveSubtitles(cutResult.script, cutResult.audioTracks);
  return profile.compose({
    rawClip: editedClip,
    audioTracks: cutResult.audioTracks,
    subtitles,
    outputPath,
  });
}

// One narration segment at a time — never overlapping — so a rate-limited TTS provider is never
// asked for more concurrency than its plan allows.
async function synthesizeSequentially(voice: VoiceGen, script: Script): Promise<Audio[]> {
  const tracks: Audio[] = [];
  for (const segment of script.segments) {
    tracks.push(await voice.synthesize(segment));
  }
  return tracks;
}
