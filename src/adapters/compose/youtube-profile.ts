// YouTubeProfile — PlatformProfile adapter, 16:9 compose via a bundled ffmpeg binary.
//
// SECURITY: ffmpeg is invoked with execFile + an argv ARRAY (never a shell string, never
// `shell: true`). execFile's array-args overload never spawns a shell to reinterpret argv, so
// shell metacharacters in a clip/audio/output path can never inject flags or commands — see
// buildComposeArgv (compose-argv.ts) and its argv-safety tests for the literal-argv-item proof.
import { execFile as execFileCb } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { FinalVideo, PlatformMetrics } from "../../domain/models/media.js";
import type { ComposeParams, PlatformProfile } from "../../domain/ports/platform-profile.js";
import { buildComposeArgv } from "./compose-argv.js";
import { resolveFfmpegPath } from "./ffmpeg-path.js";
import { toSrt } from "./srt.js";

const execFile = promisify(execFileCb);

export class YouTubeProfile implements PlatformProfile {
  // Deferred seam (non-goal): engagement metrics feedback loop — unused this slice.
  readonly metrics?: PlatformMetrics;

  async compose(params: ComposeParams): Promise<FinalVideo> {
    // Only the transient subtitle file lives in a scratch temp dir — the final video always goes
    // to the caller-provided STABLE params.outputPath (see ComposeParams doc comment).
    const workDir = await mkdtemp(join(tmpdir(), "guideo-compose-"));
    const srtPath = join(workDir, "subtitles.srt");
    await writeFile(srtPath, toSrt(params.subtitles), "utf8");

    await mkdir(dirname(params.outputPath), { recursive: true });
    const argv = buildComposeArgv(params, srtPath, params.outputPath);

    await execFile(resolveFfmpegPath(), argv);

    return { path: params.outputPath, aspectRatio: "16:9" };
  }
}
