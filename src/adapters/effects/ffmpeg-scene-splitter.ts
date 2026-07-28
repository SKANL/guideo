// FfmpegSceneSplitter — SceneSplitter adapter, per-scene-clip architecture Phase 1. Extracts each
// of a RawClip's scene ranges into its own standalone file via ONE re-encoding ffmpeg pass PER
// scene (frame-accurate trim, same discipline as FfmpegPreRollTrimmer/FfmpegPrivacyCutter — never
// `-ss` fast-seek).
//
// SECURITY: ffmpeg is invoked with an argv ARRAY (never a shell string, never `shell: true`) — see
// buildSceneSplitArgv (scene-splitter-argv.ts) and its argv-safety tests for the literal-argv-item
// proof, same discipline as trim-preroll.ts/cut-private-scenes.ts.
//
// DI: the exec function is injected (constructor param, defaulting to a real execFile-based
// implementation), never called at module load or class-construction time — same lazy pattern as
// the other Ffmpeg* adapters. Unit tests inject a fake to assert argv shape and to prove the
// passthrough path (no scenes) calls ffmpeg zero times.
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RawClip } from "../../domain/models/media.js";
import type { SceneClip, SceneSplitter } from "../../domain/ports/scene-splitter.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";
import { buildSceneSplitArgv } from "./scene-splitter-argv.js";

export type SceneSplitFfmpegExec = (ffmpegPath: string, argv: readonly string[]) => Promise<void>;

const execFileAsync = promisify(execFileCb);

async function defaultExec(ffmpegPath: string, argv: readonly string[]): Promise<void> {
  await execFileAsync(ffmpegPath, [...argv]);
}

export class FfmpegSceneSplitter implements SceneSplitter {
  constructor(private readonly exec: SceneSplitFfmpegExec = defaultExec) {}

  async split(clip: RawClip): Promise<SceneClip[]> {
    if (clip.scenes.length === 0) {
      // Passthrough: nothing to split, the whole input is already "one scene". No ffmpeg call.
      return [{ narrationSegmentId: "", path: clip.path, durationMs: clip.durationMs }];
    }

    const workDir = await mkdtemp(join(tmpdir(), "guideo-scene-split-"));
    const sceneClips: SceneClip[] = [];
    for (const [index, scene] of clip.scenes.entries()) {
      const outputPath = join(workDir, `scene-${index}.mp4`);
      const argv = buildSceneSplitArgv(
        clip.path,
        { startSec: scene.startMs / 1000, endSec: scene.endMs / 1000 },
        outputPath,
      );

      await this.exec(resolveFfmpegPath(), argv);

      sceneClips.push({
        narrationSegmentId: scene.narrationSegmentId,
        path: outputPath,
        durationMs: scene.endMs - scene.startMs,
      });
    }
    return sceneClips;
  }
}
