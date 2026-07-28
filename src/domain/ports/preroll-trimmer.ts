import type { RawClip } from "../models/media.js";

// PreRollTrimmer — the privacy/alignment stage (design doc section C). trim() removes the first
// `preRollMs` of a captured RawClip (the login/overlay-dismiss footage recorded before scene 0)
// so credentials never appear in the shown output, and so effects/audio/subtitles — all keyed to
// clip.scenes[*], which are 0-based relative to scene 0 — land on the correct frames of the
// OUTPUT video instead of being offset by the untrimmed login duration.
export interface PreRollTrimmer {
  trim(clip: RawClip, preRollMs: number): Promise<RawClip>;
}
