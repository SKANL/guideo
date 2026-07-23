// Natural-voice calibration knobs — human-feel is a knob, not a magic constant (per design's
// "Human-feel" decision). All fields are tunable per-instance via ElevenLabsVoice's constructor;
// these are just sensible starting defaults, not hardcoded behavior.
export interface VoiceCalibration {
  readonly voiceId: string;
  readonly modelId: string;
  readonly outputFormat: string;
  // 0-1: lower = more emotional range/variance, higher = more monotonous/stable.
  readonly stability: number;
  // 0-1: how closely the output adheres to the original voice.
  readonly similarityBoost: number;
  // 0-1: style exaggeration; 0 is flattest/most robotic-sounding.
  readonly style: number;
  readonly useSpeakerBoost: boolean;
  // 1.0 = normal pace.
  readonly speed: number;
}

export const DEFAULT_VOICE_CALIBRATION: VoiceCalibration = {
  // ElevenLabs' current default "Sarah" voice — verified usable on the FREE tier via API and
  // multilingual (works for Spanish). The classic "Rachel"/"Aria" IDs are now library voices that
  // free accounts cannot use via API (402 paid_plan_required). Override per-account with the
  // GUIDEO_VOICE_ID env var (see ElevenLabsVoice) or the constructor calibration.
  voiceId: "EXAVITQu4vr4xnSDxMaL",
  modelId: "eleven_multilingual_v2",
  outputFormat: "mp3_44100_128",
  stability: 0.5,
  similarityBoost: 0.75,
  // A touch of style exaggeration reads more natural/less flat than the SDK's own 0 default.
  style: 0.3,
  useSpeakerBoost: true,
  speed: 1.0,
};
