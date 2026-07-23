// YouTubeProfile — PlatformProfile adapter, 16:9 compose via a bundled ffmpeg binary.
//
// SECURITY: ffmpeg is invoked with execFile + an argv ARRAY (never a shell string, never
// `shell: true`). execFile's array-args overload never spawns a shell to reinterpret argv, so
// shell metacharacters in a clip/audio/output path can never inject flags or commands — see
// buildComposeArgv (compose-argv.ts) and its argv-safety tests for the literal-argv-item proof.
import { execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const workDir = await mkdtemp(join(tmpdir(), "guideo-compose-"));
    const srtPath = join(workDir, "subtitles.srt");
    await writeFile(srtPath, toSrt(params.subtitles), "utf8");

    const outputPath = join(workDir, `final-${randomUUID()}.mp4`);
    const argv = buildComposeArgv(params, srtPath, outputPath);

    await execFile(resolveFfmpegPath(), argv);

    return { path: outputPath, aspectRatio: "16:9" };
  }
}
