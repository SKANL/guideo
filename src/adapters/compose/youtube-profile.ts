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
import { PROFESSIONAL_RENDER_PROFILE, SHORTS_RENDER_PROFILE, SQUARE_RENDER_PROFILE, resolveRenderProfile, type RenderProfile } from "./render-profile.js";

const execFile = promisify(execFileCb);

export class YouTubeProfile implements PlatformProfile {
  // Deferred seam (non-goal): engagement metrics feedback loop — unused this slice.
  readonly metrics?: PlatformMetrics;
  constructor(private readonly defaultRenderProfile: RenderProfile = PROFESSIONAL_RENDER_PROFILE) {}

  async compose(params: ComposeParams): Promise<FinalVideo> {
    // Only the transient subtitle file lives in a scratch temp dir — the final video always goes
    // to the caller-provided STABLE params.outputPath (see ComposeParams doc comment).
    const workDir = await mkdtemp(join(tmpdir(), "guideo-compose-"));
    const srtPath = join(workDir, "subtitles.srt");
    const profile = resolveRenderProfile(params.renderProfile ?? this.defaultRenderProfile.name);
    await writeFile(srtPath, toSrt(params.subtitles, profile), "utf8");

    await mkdir(dirname(params.outputPath), { recursive: true });
    const argv = buildComposeArgv({ ...params, renderProfile: profile.name }, srtPath, params.outputPath);

    await execFile(resolveFfmpegPath(), argv);

    return { path: params.outputPath, aspectRatio: profile.aspectRatio };
  }
}

/** Explicit social delivery adapters share one deterministic, frame-preserving compose path. */
export class ShortsProfile extends YouTubeProfile {
  constructor() { super(SHORTS_RENDER_PROFILE); }
}

export class SquareProfile extends YouTubeProfile {
  constructor() { super(SQUARE_RENDER_PROFILE); }
}
