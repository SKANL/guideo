import type { Audio, RawClip } from "../models/media.js";
import type { Script } from "../models/script.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";

export interface PrivacyCutResult {
  readonly clip: RawClip;
  readonly script: Script;
  readonly audioTracks: readonly Audio[];
}

// PrivacyCutter — the privacy/redaction stage (design doc section C, sub-project 5b). cut()
// removes every "private" scene entirely from the output: its video range, its narration Audio
// track, and its Script segment (subtitles are derived from the returned Script downstream) —
// then rebases every kept scene's timing contiguous from 0. Requires ApprovedStoryboard, not
// Storyboard — same compile-time REVIEW-gate hard stop as RecordingEngine.capture()/EffectsEngine.
export interface PrivacyCutter {
  cut(
    clip: RawClip,
    storyboard: ApprovedStoryboard,
    script: Script,
    audioTracks: readonly Audio[],
  ): Promise<PrivacyCutResult>;
}
