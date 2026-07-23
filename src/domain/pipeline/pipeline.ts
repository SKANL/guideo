import type { Audio, FinalVideo } from "../models/media.js";
import type { Script } from "../models/script.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";
import type { PlatformProfile } from "../ports/platform-profile.js";
import type { RecordingEngine } from "../ports/recording-engine.js";
import type { VoiceGen } from "../ports/voice-gen.js";
import { deriveSubtitles } from "./subtitles.js";

// render() only accepts an ApprovedStoryboard — the compile-time REVIEW-gate hard stop realized
// at the type level: plan()'s raw { script, storyboard } cannot reach render() without first
// going through ReviewGate.review() (src/domain/review-gate.ts). capture() runs concurrently with
// the whole voice batch (they're independent), but the voice segments themselves are synthesized
// SEQUENTIALLY — TTS providers cap concurrent requests (ElevenLabs free tier = 2; fanning out all
// segments at once hit a 429). Subtitles are derived purely from the Script's known text plus each
// segment's actual synthesized audio duration (no transcription, per spec); compose() runs last.
export async function render(
  approved: ApprovedStoryboard,
  script: Script,
  engine: RecordingEngine,
  voice: VoiceGen,
  profile: PlatformProfile,
): Promise<FinalVideo> {
  const [rawClip, audioTracks] = await Promise.all([
    engine.capture(approved),
    synthesizeSequentially(voice, script),
  ]);
  const subtitles = deriveSubtitles(script, audioTracks);
  return profile.compose({ rawClip, audioTracks, subtitles });
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
