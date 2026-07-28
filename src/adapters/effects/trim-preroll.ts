// FfmpegPreRollTrimmer — PreRollTrimmer adapter, the privacy/alignment stage (design doc section
// C). Removes the first `preRollMs` of a captured RawClip — the login/overlay-dismiss footage
// recorded before scene 0 — via ONE re-encoding ffmpeg pass, so credentials never appear in the
// shown output and scene-keyed effects/audio/subtitles land on the correct frames.
//
// SECURITY: ffmpeg is invoked with an argv ARRAY (never a shell string, never `shell: true`) —
// see buildTrimPrerollArgv (trim-preroll-argv.ts) and its argv-safety tests for the literal-argv-
// item proof, same discipline as compose's YouTubeProfile and the effects stage.
//
// DI: the exec function is injected (constructor param, defaulting to a real execFile-based
// implementation), never called at module load or class-construction time — same lazy pattern as
// FfmpegEffectsEngine/WebRecordingEngine. Unit tests inject a fake to assert argv shape and to
// prove the passthrough path (preRollMs <= 0) calls ffmpeg zero times.
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RawClip } from "../../domain/models/media.js";
import type { PreRollTrimmer } from "../../domain/ports/preroll-trimmer.js";
import { resolveFfmpegPath } from "../compose/ffmpeg-path.js";
import { buildTrimPrerollArgv } from "./trim-preroll-argv.js";

export type PreRollFfmpegExec = (ffmpegPath: string, argv: readonly string[]) => Promise<void>;

const execFileAsync = promisify(execFileCb);

async function defaultExec(ffmpegPath: string, argv: readonly string[]): Promise<void> {
  await execFileAsync(ffmpegPath, [...argv]);
}

export class FfmpegPreRollTrimmer implements PreRollTrimmer {
  constructor(private readonly exec: PreRollFfmpegExec = defaultExec) {}

  async trim(clip: RawClip, preRollMs: number): Promise<RawClip> {
    if (preRollMs <= 0) {
      return clip;
    }

    const workDir = await mkdtemp(join(tmpdir(), "guideo-preroll-"));
    const outputPath = join(workDir, "trimmed.mp4");
    const argv = buildTrimPrerollArgv(clip.path, preRollMs / 1000, outputPath);

    await this.exec(resolveFfmpegPath(), argv);

    // preRollMs resets to 0: the returned clip's video now starts at scene 0, matching its
    // (already 0-based) scenes[*] ranges exactly — nothing left to trim.
    return { ...clip, path: outputPath, preRollMs: 0 };
  }
}
