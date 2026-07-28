// FfmpegPrivacyCutter — PrivacyCutter adapter, the privacy/redaction stage (design doc section C,
// sub-project 5b). Removes every "private" scene entirely from a captured RawClip (video), its
// narration Audio track, and its Script segment — see privacy-cut.ts for the pure plan/rebase
// logic — via ONE re-encoding ffmpeg pass (trim each kept range + concat, video-only).
//
// SECURITY: ffmpeg is invoked with an argv ARRAY (never a shell string, never `shell: true`) —
// see buildCutPrivateScenesArgv (cut-private-scenes-argv.ts) and its argv-safety tests for the
// literal-argv-item proof, same discipline as trim-preroll.ts/ffmpeg-effects.ts.
//
// DI: the exec function is injected (constructor param, defaulting to a real execFile-based
// implementation), never called at module load or class-construction time — same lazy pattern as
// FfmpegPreRollTrimmer/FfmpegEffectsEngine. Unit tests inject a fake to assert argv shape and to
// prove the passthrough path (no private scene) calls ffmpeg zero times.
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Audio, RawClip, SceneRange } from "../../domain/models/media.js";
import type { Script } from "../../domain/models/script.js";
import type { ApprovedStoryboard } from "../../domain/models/storyboard.js";
import { planPrivacyCut } from "../../domain/pipeline/privacy-cut.js";
import type { PrivacyCutResult, PrivacyCutter } from "../../domain/ports/privacy-cutter.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";
import { buildCutPrivateScenesArgv } from "./cut-private-scenes-argv.js";

export type CutFfmpegExec = (ffmpegPath: string, argv: readonly string[]) => Promise<void>;

const execFileAsync = promisify(execFileCb);

async function defaultExec(ffmpegPath: string, argv: readonly string[]): Promise<void> {
  await execFileAsync(ffmpegPath, [...argv]);
}

export class FfmpegPrivacyCutter implements PrivacyCutter {
  constructor(private readonly exec: CutFfmpegExec = defaultExec) {}

  async cut(
    clip: RawClip,
    storyboard: ApprovedStoryboard,
    script: Script,
    audioTracks: readonly Audio[],
  ): Promise<PrivacyCutResult> {
    const plan = planPrivacyCut(clip.scenes, storyboard, script, audioTracks);
    if (plan.isNoop) {
      return { clip, script, audioTracks };
    }

    const workDir = await mkdtemp(join(tmpdir(), "guideo-privacy-cut-"));
    const outputPath = join(workDir, "cut.mp4");
    const ranges = plan.kept.map((scene) => ({
      startSec: scene.sourceStartMs / 1000,
      endSec: scene.sourceEndMs / 1000,
    }));
    const argv = buildCutPrivateScenesArgv(clip.path, ranges, outputPath);

    await this.exec(resolveFfmpegPath(), argv);

    const scenes: SceneRange[] = plan.kept.map((scene) => ({
      narrationSegmentId: scene.narrationSegmentId,
      startMs: scene.startMs,
      endMs: scene.endMs,
    }));
    const durationMs = scenes.length > 0 ? (scenes[scenes.length - 1]?.endMs ?? 0) : 0;

    return {
      clip: { ...clip, path: outputPath, scenes, durationMs },
      script: plan.script,
      audioTracks: plan.audioTracks,
    };
  }
}
