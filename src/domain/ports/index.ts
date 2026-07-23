// Domain ports: Target, RecordingEngine, ScriptGen, VoiceGen, PlatformProfile (Phase 3).
// Random port (T2.6, tasks-doc numbering) is deferred — not consumed until Phase 4's
// humanize.ts adapter, so it is out of this apply pass's explicit scope.
export * from "./platform-profile.js";
export * from "./recording-engine.js";
export * from "./script-gen.js";
export * from "./target.js";
export * from "./voice-gen.js";
