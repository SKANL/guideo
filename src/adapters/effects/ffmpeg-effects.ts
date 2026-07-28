// FfmpegEffectsEngine — EffectsEngine adapter, the Edit stage (design doc section B), relocated to
// run PER SCENE CLIP (per-scene-clip architecture, completing Phase 1). applyToScenes() maps each
// scene clip's own effects onto its OWN whole timeline (see effects-graph.ts's
// buildSceneEffectsGraph) and runs ONE ffmpeg filter_complex pass PER scene clip that has an effect
// — a scene clip with none is a passthrough, no ffmpeg call. Each edited file is written to its own
// scratch temp path (the FINAL stable output remains compose's job, unchanged — see YouTubeProfile).
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
import type { SceneClip } from "../../domain/ports/scene-splitter.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";
import { buildEffectsArgv } from "./effects-argv.js";
import { buildSceneEffectsGraph } from "./effects-graph.js";

export type FfmpegExec = (ffmpegPath: string, argv: readonly string[]) => Promise<void>;

const execFileAsync = promisify(execFileCb);

async function defaultExec(ffmpegPath: string, argv: readonly string[]): Promise<void> {
  await execFileAsync(ffmpegPath, [...argv]);
}

export class FfmpegEffectsEngine implements EffectsEngine {
  constructor(private readonly exec: FfmpegExec = defaultExec) {}

  async applyToScenes(
    clip: RawClip,
    sceneClips: readonly SceneClip[],
    storyboard: ApprovedStoryboard,
  ): Promise<SceneClip[]> {
    const result: SceneClip[] = [];
    for (const sceneClip of sceneClips) {
      result.push(await this.applyToScene(clip, sceneClip, storyboard));
    }
    return result;
  }

  private async applyToScene(
    clip: RawClip,
    sceneClip: SceneClip,
    storyboard: ApprovedStoryboard,
  ): Promise<SceneClip> {
    const graph = buildSceneEffectsGraph(clip, sceneClip, storyboard);
    if (graph === null) {
      return sceneClip;
    }

    const workDir = await mkdtemp(join(tmpdir(), "guideo-scene-effects-"));
    const outputPath = join(workDir, "edited.mp4");
    const argv = buildEffectsArgv(
      sceneClip.path,
      graph.filterComplex,
      graph.outputLabel,
      outputPath,
    );

    await this.exec(resolveFfmpegPath(), argv);

    return { ...sceneClip, path: outputPath };
  }
}
