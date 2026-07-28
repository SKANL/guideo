// FfmpegSceneAssembler — SceneAssembler adapter, per-scene-clip architecture Phase 1. Composes
// per-scene clips (FfmpegSceneSplitter's output) into ONE assembled clip, applying a duration-
// preserving dip transition at every boundary via ONE ffmpeg pass (per-clip local fade + concat).
//
// SECURITY: ffmpeg is invoked with an argv ARRAY (never a shell string, never `shell: true`) — see
// buildSceneAssembleArgv (scene-assembler-argv.ts) and its argv-safety tests for the literal-argv-
// item proof, same discipline as the other Ffmpeg* adapters.
//
// DI: the exec function is injected (constructor param, defaulting to a real execFile-based
// implementation), never called at module load or class-construction time — same lazy pattern as
// the other Ffmpeg* adapters. Unit tests inject a fake to assert argv shape and to prove the
// passthrough path (a single scene clip) calls ffmpeg zero times.
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RawClip, SceneRange } from "../../domain/models/media.js";
import type { SceneAssembler, SceneAssemblerConfig } from "../../domain/ports/scene-assembler.js";
import type { SceneClip } from "../../domain/ports/scene-splitter.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";
import { buildSceneAssembleArgv } from "./scene-assembler-argv.js";

export type SceneAssembleFfmpegExec = (
  ffmpegPath: string,
  argv: readonly string[],
) => Promise<void>;

const execFileAsync = promisify(execFileCb);

async function defaultExec(ffmpegPath: string, argv: readonly string[]): Promise<void> {
  await execFileAsync(ffmpegPath, [...argv]);
}

// ~0.25s dip — short enough to stay unobtrusive at scene boundaries, long enough to read as an
// intentional cut rather than a hard jolt.
const DEFAULT_TRANSITION_DURATION_SEC = 0.25;

function rebaseScenes(sceneClips: readonly SceneClip[]): {
  scenes: SceneRange[];
  durationMs: number;
} {
  let elapsedMs = 0;
  const scenes: SceneRange[] = sceneClips.map((clip) => {
    const startMs = elapsedMs;
    const endMs = elapsedMs + clip.durationMs;
    elapsedMs = endMs;
    return { narrationSegmentId: clip.narrationSegmentId, startMs, endMs };
  });
  return { scenes, durationMs: elapsedMs };
}

export class FfmpegSceneAssembler implements SceneAssembler {
  constructor(private readonly exec: SceneAssembleFfmpegExec = defaultExec) {}

  async assemble(
    sceneClips: readonly SceneClip[],
    config: Partial<SceneAssemblerConfig> = {},
  ): Promise<RawClip> {
    if (sceneClips.length === 0) {
      throw new Error("FfmpegSceneAssembler.assemble: sceneClips must not be empty");
    }

    if (sceneClips.length === 1) {
      // Passthrough: nothing to concatenate or transition between. No ffmpeg call.
      const only = sceneClips[0] as SceneClip;
      return {
        path: only.path,
        durationMs: only.durationMs,
        aspectRatio: "16:9",
        scenes: [
          { narrationSegmentId: only.narrationSegmentId, startMs: 0, endMs: only.durationMs },
        ],
        preRollMs: 0,
      };
    }

    const transitionDurationSec = config.transitionDurationSec ?? DEFAULT_TRANSITION_DURATION_SEC;
    const workDir = await mkdtemp(join(tmpdir(), "guideo-scene-assemble-"));
    const outputPath = join(workDir, "assembled.mp4");
    const argv = buildSceneAssembleArgv(
      sceneClips.map((clip) => ({ path: clip.path, durationSec: clip.durationMs / 1000 })),
      transitionDurationSec,
      outputPath,
    );

    await this.exec(resolveFfmpegPath(), argv);

    const { scenes, durationMs } = rebaseScenes(sceneClips);

    return {
      path: outputPath,
      durationMs,
      aspectRatio: "16:9",
      scenes,
      preRollMs: 0,
    };
  }
}
