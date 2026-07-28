import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFfmpegPath } from "../../../src/adapters/compose/ffmpeg-path.js";
import { YouTubeProfile } from "../../../src/adapters/compose/youtube-profile.js";
import type { Audio, RawClip } from "../../../src/domain/models/media.js";
import type { ComposeParams } from "../../../src/domain/ports/platform-profile.js";

const execFile = promisify(execFileCb);

// Real integration test: actually invokes the resolved ffmpeg binary. Skipped (not failed) if
// ffmpeg cannot run in this sandbox — the argv-safety unit tests remain the hard gate regardless.
let ffmpegAvailable = false;
let fixtureDir: string;
let rawClip: RawClip;
let audio: Audio;

beforeAll(async () => {
  try {
    const ffmpegPath = resolveFfmpegPath();
    fixtureDir = await mkdtemp(join(tmpdir(), "guideo-compose-fixture-"));

    const clipPath = join(fixtureDir, "clip.mp4");
    await execFile(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=1:size=320x180:rate=10",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      clipPath,
    ]);

    const audioPath = join(fixtureDir, "seg-1.mp3");
    await execFile(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      "1",
      "-c:a",
      "libmp3lame",
      audioPath,
    ]);

    rawClip = { path: clipPath, durationMs: 1000, aspectRatio: "16:9", scenes: [] };
    audio = { segmentId: "seg-1", path: audioPath, durationMs: 1000 };
    ffmpegAvailable = true;
  } catch (error) {
    // ponytail: sandbox may not allow spawning ffmpeg at all (not just missing binary) — skip
    // the integration test with a clear reason rather than failing the whole suite.
    console.warn(`[youtube-profile.integration] ffmpeg unavailable, skipping: ${String(error)}`);
    ffmpegAvailable = false;
  }
}, 30_000);

afterAll(async () => {
  if (fixtureDir) {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

describe("YouTubeProfile (ffmpeg integration)", () => {
  it("composes a raw clip + audio + subtitles into a playable 16:9 final video", async (ctx) => {
    if (!ffmpegAvailable) {
      ctx.skip();
      return;
    }

    const profile = new YouTubeProfile();
    // A subdir that does not exist yet — proves compose() creates it and writes there directly,
    // never to a self-chosen OS temp dir.
    const outputPath = join(fixtureDir, "output", "youtube.mp4");
    const params: ComposeParams = {
      rawClip,
      audioTracks: [audio],
      subtitles: [{ text: "Hello world.", startMs: 0, durationMs: 1000 }],
      outputPath,
    };

    const finalVideo = await profile.compose(params);

    expect(finalVideo.aspectRatio).toBe("16:9");
    expect(finalVideo.path).toBe(outputPath);
    const stats = await stat(finalVideo.path);
    expect(stats.size).toBeGreaterThan(0);
  }, 30_000);
});
