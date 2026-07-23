import type { Audio } from "../models/media.js";
import type { NarrationSegment } from "../models/script.js";

// synthesize() is called once per Script segment (see design's data flow: "VoiceGen.synthesize
// per segment"), not once for a whole Script — each call yields one Audio track.
export interface VoiceGen {
  synthesize(segment: NarrationSegment): Promise<Audio>;
}
