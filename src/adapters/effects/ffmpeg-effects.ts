// FfmpegEffectsEngine — EffectsEngine adapter, the Edit stage (design doc section B). Maps each
// step's AI-proposed effects onto its scene's time range (see effects-graph.ts) and runs ONE
// ffmpeg filter_complex pass to apply them all, writing the edited clip to a scratch temp path
// (the FINAL stable output remains compose's job, unchanged — see YouTubeProfile).
//
// SECURITY: ffmpeg is invoked with an argv ARRAY (never a shell string, never `shell: true`) —
// see buildEffectsArgv (effects-argv.ts) and its argv-safety tests for the literal-argv-item
// proof, same discipline as compose's YouTubeProfile.
//
// DI: the exec function is injected (constructor param, defaulting to a real execFile-based
// implementation), never called at module load or class-construction time — same lazy pattern as
// ElevenLabsVoice/WebRecordingEngine. Unit tests inject a fake to assert argv shape and to prove
// the passthrough path calls ffmpeg zero times, with no real process spawned.
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RawClip } from "../../domain/models/media.js";
import type { ApprovedStoryboard } from "../../domain/models/storyboard.js";
import type { EffectsEngine } from "../../domain/ports/effects.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";
import { buildEffectsArgv } from "./effects-argv.js";
import { buildEffectsGraph } from "./effects-graph.js";

export type FfmpegExec = (ffmpegPath: string, argv: readonly string[]) => Promise<void>;

const execFileAsync = promisify(execFileCb);

async function defaultExec(ffmpegPath: string, argv: readonly string[]): Promise<void> {
  await execFileAsync(ffmpegPath, [...argv]);
}

export class FfmpegEffectsEngine implements EffectsEngine {
  constructor(private readonly exec: FfmpegExec = defaultExec) {}

  async apply(clip: RawClip, storyboard: ApprovedStoryboard): Promise<RawClip> {
    const graph = buildEffectsGraph(clip, storyboard);
    if (graph === null) {
      return clip;
    }

    const workDir = await mkdtemp(join(tmpdir(), "guideo-effects-"));
    const outputPath = join(workDir, "edited.mp4");
    const argv = buildEffectsArgv(clip.path, graph.filterComplex, graph.outputLabel, outputPath);

    await this.exec(resolveFfmpegPath(), argv);

    return { ...clip, path: outputPath };
  }
}
