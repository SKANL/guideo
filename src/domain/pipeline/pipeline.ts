import type { Audio, FinalVideo } from "../models/media.js";
import type { Script } from "../models/script.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";
import type { PlatformProfile } from "../ports/platform-profile.js";
import type { RecordingEngine } from "../ports/recording-engine.js";
import type { VoiceGen } from "../ports/voice-gen.js";
import { deriveSubtitles } from "./subtitles.js";

// render() only accepts an ApprovedStoryboard — the compile-time REVIEW-gate hard stop realized
// at the type level: plan()'s raw { script, storyboard } cannot reach render() without first
// going through ReviewGate.review() (src/domain/review-gate.ts). capture() and synthesize() are
// independent of each other's output, so they run concurrently; subtitles are derived purely
// from the Script's known text plus each segment's actual synthesized audio duration (no
// transcription, per spec's `subtitles` requirement); compose() runs last.
export async function render(
  approved: ApprovedStoryboard,
  script: Script,
  engine: RecordingEngine,
  voice: VoiceGen,
  profile: PlatformProfile,
): Promise<FinalVideo> {
  const [rawClip, audioTracks] = await Promise.all([
    engine.capture(approved),
    Promise.all<Audio>(script.segments.map((segment) => voice.synthesize(segment))),
  ]);
  const subtitles = deriveSubtitles(script, audioTracks);
  return profile.compose({ rawClip, audioTracks, subtitles });
}
