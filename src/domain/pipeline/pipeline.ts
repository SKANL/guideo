import type { Audio, FinalVideo, RawClip, Subtitle } from "../models/media.js";
import type { NarrationMode } from "../models/narration-mode.js";
import type { Script } from "../models/script.js";
import type { ApprovedStoryboard } from "../models/storyboard.js";
import type { EffectsEngine } from "../ports/effects.js";
import type { PlatformProfile } from "../ports/platform-profile.js";
import type { PreRollTrimmer } from "../ports/preroll-trimmer.js";
import type { PrivacyCutter } from "../ports/privacy-cutter.js";
import type { RecordingEngine } from "../ports/recording-engine.js";
import type { SceneAssembler } from "../ports/scene-assembler.js";
import type { SceneClip, SceneSplitter } from "../ports/scene-splitter.js";
import type { VoiceGen } from "../ports/voice-gen.js";
import type { UsageLedger } from "../ports/usage-ledger.js";
import type { UsageEstimate, UsageResult } from "../ports/usage-ledger.js";
import { deriveSubtitles } from "./subtitles.js";

// trimPreRoll (privacy/alignment fix, design doc section C, sub-project 5a): whether to cut the
// login/overlay-dismiss footage recorded before scene 0 from the output. Defaults to true —
// credentials should never appear in the shown video, and effects/audio/subtitles are keyed to
// 0-based scene ranges that only line up once that footage is removed. A caller can opt OUT
// (e.g. for debugging capture) by passing { trimPreRoll: false }.
//
// narration (narration-mode feature): "voice" | "subtitles" | "both", defaults to "both" — the
// pre-narration-mode behavior (voice audio muxed in + soft subtitles attached). "subtitles" skips
// voice synthesis entirely (no TTS call, no spend, no ElevenLabs quota needed) and paces capture
// off each Script segment's own planned timing.durationMs instead of real audio duration.
export interface RenderOptions {
  readonly trimPreRoll?: boolean;
  readonly narration?: NarrationMode;
}

// RenderPorts: the subset of app/factory.ts's Container that the render pipeline needs. Declared
// locally (not imported from app/factory.ts) so the domain layer never depends on the app layer —
// any Container satisfies this structurally, no explicit implements/cast needed at the call site.
export interface RenderPorts {
  readonly recordingEngine: RecordingEngine;
  readonly preRollTrimmer: PreRollTrimmer;
  readonly privacyCutter: PrivacyCutter;
  readonly effectsEngine: EffectsEngine;
  readonly sceneSplitter: SceneSplitter;
  readonly sceneAssembler: SceneAssembler;
  readonly voiceGen: VoiceGen;
  readonly platformProfile: PlatformProfile;
  readonly usageLedger?: UsageLedger;
}

// RenderContext: the render state folded through the stage list, immutable-update style — every
// stage's run() returns a NEW context object (`{ ...ctx, ... }`), never mutating the one it
// received. Fields start at their "not produced yet" value (null/[]/empty Map) and are filled in
// as the matching stage runs; a stage that needs an earlier stage's output can assume it has
// already run (stage ORDER is what the whole abstraction exists to make explicit and overridable).
export interface RenderContext {
  readonly approved: ApprovedStoryboard;
  readonly script: Script;
  readonly audioTracks: readonly Audio[];
  readonly segmentDurationsMs: ReadonlyMap<string, number>;
  readonly rawClip: RawClip | null;
  readonly sceneClips: readonly SceneClip[];
  readonly subtitles: readonly Subtitle[];
  readonly outputPath: string;
  readonly options: RenderOptions;
  // Resolved once at render() init (options.narration ?? "both") — every stage reads this instead
  // of re-deriving the default, so "which stages actually run TTS/produce subtitles" stays a
  // single source of truth threaded through the same immutable-update context every other stage
  // already folds over.
  readonly narration: NarrationMode;
  // Set only by the terminal (compose) stage — render() reads this back out after folding every
  // stage, since PipelineStage.run() must always return a RenderContext, never a bare FinalVideo.
  readonly finalVideo: FinalVideo | null;
}

// PipelineStage: one composable render step. `name` identifies it for logging/tests (e.g.
// asserting stage order); run() takes the current context and returns the next one.
//
// To add a new stage: write a class implementing this interface (constructor takes whatever port
// it needs), then splice an instance into defaultRenderStages()'s returned array at the position
// it should run — or a caller can pass its own full stage list into render()'s `stages` param to
// add/reorder/insert stages without touching this file at all.
export interface PipelineStage {
  readonly name: string;
  run(ctx: RenderContext): Promise<RenderContext>;
}

function requireClip(ctx: RenderContext, stageName: string): RawClip {
  if (ctx.rawClip === null) {
    throw new Error(`${stageName}: no clip in RenderContext yet (must run after a capture stage)`);
  }
  return ctx.rawClip;
}

// Voice synthesizes FIRST: narration-driven timing (real e2e: capture paced itself independent of
// narration, giving a 21s video against a 43s script). Each segment's synthesized Audio.durationMs
// becomes that segment's target on-screen time, so CaptureStage can pace scenes to match. Segments
// are synthesized SEQUENTIALLY, never overlapping — TTS providers cap concurrent requests
// (ElevenLabs free tier = 2; fanning out all segments at once hit a 429).
//
// narration-mode gate: in "subtitles" mode this makes ZERO calls to VoiceGen.synthesize — no TTS
// spend, unblocking local/CI validation runs with no ElevenLabs quota. audioTracks stays empty and
// segmentDurationsMs falls back to each segment's own planned timing.durationMs (the LLM's
// estimate), which is what CaptureStage paces scenes against either way — so capture pacing works
// identically regardless of where the durations came from.
class SynthesizeVoiceStage implements PipelineStage {
  readonly name = "synthesize-voice";
  constructor(private readonly voice: VoiceGen, private readonly ledger?: UsageLedger) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    if (ctx.narration === "subtitles" || ctx.narration === "silent") {
      const segmentDurationsMs = new Map(
        ctx.script.segments.map((segment) => [segment.id, segment.timing.durationMs]),
      );
      return { ...ctx, audioTracks: [], segmentDurationsMs };
    }
    const audioTracks: Audio[] = [];
    for (const segment of ctx.script.segments) {
      const usageVoice = this.voice as VoiceGen & {
        estimateUsage?(segment: Script["segments"][number]): UsageEstimate;
        synthesizeWithUsage?(segment: Script["segments"][number]): Promise<{ audio: Audio; usage: UsageResult }>;
      };
      const estimate = usageVoice.estimateUsage?.(segment) ?? { unit: "usd-micros" as const, amount: 0 };
      const reservation = this.ledger ? await this.ledger.reserve({ operation: "voice", estimate }) : null;
      try {
        const result = usageVoice.synthesizeWithUsage && estimate.amount > 0 ? await usageVoice.synthesizeWithUsage(segment) : { audio: await this.voice.synthesize(segment), usage: { unit: "usd-micros" as const, amount: 0, cache: "miss" as const, provider: "unknown" } };
        const audio = result.audio;
        if (reservation) await this.ledger!.commit(reservation.id, result.usage);
        audioTracks.push(audio);
      } catch (error) {
        if (reservation) await this.ledger!.release(reservation.id, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    const segmentDurationsMs = new Map(
      audioTracks.map((audio) => [audio.segmentId, audio.durationMs]),
    );
    return { ...ctx, audioTracks, segmentDurationsMs };
  }
}

class CaptureStage implements PipelineStage {
  readonly name = "capture";
  constructor(private readonly engine: RecordingEngine) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    const rawClip = await this.engine.capture(ctx.approved, ctx.segmentDurationsMs);
    return { ...ctx, rawClip };
  }
}

// The pre-roll trim stage runs BEFORE effects (unless options.trimPreRoll is false) — capture()'s
// scenes[*] are 0-based relative to scene 0, so effects/subtitles/audio only land on the right
// frames once the login/overlay-dismiss footage ahead of scene 0 is cut.
class TrimPreRollStage implements PipelineStage {
  readonly name = "trim-preroll";
  constructor(private readonly trimmer: PreRollTrimmer) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    if (ctx.options.trimPreRoll === false) return ctx;
    const clip = requireClip(ctx, this.name);
    const rawClip = await this.trimmer.trim(clip, clip.preRollMs);
    return { ...ctx, rawClip };
  }
}

// The PRIVACY CUT stage (design doc section C, sub-project 5b) runs BEFORE effects too: it removes
// every scene the storyboard marks `visibility: "private"` — video, its narration Audio track, and
// its Script segment — and rebases every kept scene contiguous from 0. Effects need no separate
// "re-gating" here: they're applied AFTER the cut, against the (already rebased) clip's `scenes`,
// so private steps' effects are naturally skipped and kept steps' effects gate to the rebased
// times for free.
class PrivacyCutStage implements PipelineStage {
  readonly name = "privacy-cut";
  constructor(private readonly cutter: PrivacyCutter) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    const clip = requireClip(ctx, this.name);
    const result = await this.cutter.cut(clip, ctx.approved, ctx.script, ctx.audioTracks);
    return { ...ctx, rawClip: result.clip, script: result.script, audioTracks: result.audioTracks };
  }
}

// Per-scene-clip architecture (Phase 1), part 1/2: extracts the (cut) clip's scenes into
// standalone per-scene files (see scene-splitter.ts).
class SceneSplitStage implements PipelineStage {
  readonly name = "scene-split";
  constructor(private readonly splitter: SceneSplitter) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    const clip = requireClip(ctx, this.name);
    const sceneClips = await this.splitter.split(clip);
    return { ...ctx, sceneClips };
  }
}

// The Edit stage (design doc section B), relocated to run PER SCENE CLIP (per-scene-clip
// architecture, completing Phase 1): runs AFTER the split, so each scene clip gets its own effects
// gated within its OWN timeline rather than a shared/whole-clip one. `ctx.rawClip` here is still
// the pre-split (cut) clip — needed for its `resolvedEffects` and the storyboard's effect params —
// while `ctx.sceneClips` is what actually gets edited/replaced.
class EffectsStage implements PipelineStage {
  readonly name = "effects";
  constructor(private readonly effects: EffectsEngine) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    const clip = requireClip(ctx, this.name);
    const sceneClips = await this.effects.applyToScenes(clip, ctx.sceneClips, ctx.approved);
    return { ...ctx, sceneClips };
  }
}

// Per-scene-clip architecture (Phase 1), part 2/2: recomposes the (now edited) scene clips into ONE clip
// with a duration-preserving dip transition at every boundary (see scene-assembler.ts). No overlap
// between scenes means total duration is unchanged, so subtitles/audio (both keyed to the ORIGINAL
// scene timing) stay aligned.
class SceneAssembleStage implements PipelineStage {
  readonly name = "scene-assemble";
  constructor(private readonly assembler: SceneAssembler) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    const rawClip = await this.assembler.assemble(ctx.sceneClips);
    return { ...ctx, rawClip };
  }
}

// Subtitles are derived from the (possibly cut+rebased) Script's known text, timed to the
// ASSEMBLED clip's REAL per-scene ranges (clip.scenes) — NOT ctx.segmentDurationsMs (planned/audio
// durations). Capture only paces UP to that planned target; click+navigation overshoot makes the
// real on-screen scene longer, which used to drift subtitles ~1 scene ahead of the video. Running
// this stage AFTER SceneAssembleStage (see defaultRenderStages below) is what makes ctx.rawClip's
// scenes the final, real timing rather than a pre-assembly estimate.
//
// narration-mode gate: "voice" mode produces NO subtitles at all (subtitles stays the initial
// empty array) — the spec calls for voice-only output with nothing burned/attached.
class DeriveSubtitlesStage implements PipelineStage {
  readonly name = "derive-subtitles";
  async run(ctx: RenderContext): Promise<RenderContext> {
    if (ctx.narration === "voice" || ctx.narration === "silent") return ctx;
    const clip = requireClip(ctx, this.name);
    return { ...ctx, subtitles: deriveSubtitles(ctx.script, clip.scenes) };
  }
}

// Terminal stage: compose() receives the ASSEMBLED clip (never the merely edited one). narration
// is forwarded explicitly so the compose adapter knows whether to mux audio, attach soft
// subtitles, or burn them into a silent video — see platform-profile.ts's ComposeParams.
class ComposeStage implements PipelineStage {
  readonly name = "compose";
  constructor(private readonly profile: PlatformProfile) {}
  async run(ctx: RenderContext): Promise<RenderContext> {
    const rawClip = requireClip(ctx, this.name);
    const finalVideo = await this.profile.compose({
      rawClip,
      audioTracks: ctx.audioTracks,
      subtitles: ctx.subtitles,
      outputPath: ctx.outputPath,
      narration: ctx.narration,
    });
    return { ...ctx, finalVideo };
  }
}

// The DEFAULT ordered stage list, built from a RenderPorts (any app Container satisfies this
// structurally). render() uses this unless a caller passes its own `stages` array — to add,
// remove, reorder, or insert a stage without touching this file, build a custom array (spread this
// one, or write your own from scratch) and pass it as render()'s last argument.
export function defaultRenderStages(ports: RenderPorts): PipelineStage[] {
  return [
    new SynthesizeVoiceStage(ports.voiceGen, ports.usageLedger),
    new CaptureStage(ports.recordingEngine),
    new TrimPreRollStage(ports.preRollTrimmer),
    new PrivacyCutStage(ports.privacyCutter),
    new SceneSplitStage(ports.sceneSplitter),
    new EffectsStage(ports.effectsEngine),
    new SceneAssembleStage(ports.sceneAssembler),
    new DeriveSubtitlesStage(),
    new ComposeStage(ports.platformProfile),
  ];
}

// render() only accepts an ApprovedStoryboard — the compile-time REVIEW-gate hard stop realized
// at the type level: plan()'s raw { script, storyboard } cannot reach render() without first going
// through ReviewGate.review() (src/domain/review-gate.ts). It builds the default ordered stage
// list from `ports` (or uses the caller-supplied `stages` override) and folds it over an initial
// RenderContext, returning the FinalVideo the terminal (compose) stage produced.
export async function render(
  ports: RenderPorts,
  approved: ApprovedStoryboard,
  script: Script,
  outputPath: string,
  options: RenderOptions = {},
  stages: readonly PipelineStage[] = defaultRenderStages(ports),
): Promise<FinalVideo> {
  let ctx: RenderContext = {
    approved,
    script,
    audioTracks: [],
    segmentDurationsMs: new Map(),
    rawClip: null,
    sceneClips: [],
    subtitles: [],
    outputPath,
    options,
    narration: options.narration ?? "both",
    finalVideo: null,
  };
  for (const stage of stages) {
    ctx = await stage.run(ctx);
  }
  if (ctx.finalVideo === null) {
    throw new Error(
      "render(): stage list finished without producing a FinalVideo (missing a compose stage?)",
    );
  }
  return ctx.finalVideo;
}
