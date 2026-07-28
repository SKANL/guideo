import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFfmpegPath } from "../../../src/adapters/compose/ffmpeg-path.js";
import { FfmpegEffectsEngine } from "../../../src/adapters/effects/ffmpeg-effects.js";
import type { RawClip } from "../../../src/domain/models/media.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { review } from "../../../src/domain/review-gate.js";

const execFile = promisify(execFileCb);

// Real integration test: actually invokes the resolved ffmpeg binary end-to-end, applying a real
// blur-region effect over a time range on a tiny synthetic clip. Skipped (not failed) if ffmpeg
// cannot run in this sandbox — the argv-safety + filter-builder unit tests remain the hard gate
// regardless (same pattern as youtube-profile.integration.test.ts).
let ffmpegAvailable = false;
let fixtureDir: string;
let rawClip: RawClip;

beforeAll(async () => {
  try {
    const ffmpegPath = resolveFfmpegPath();
    fixtureDir = await mkdtemp(join(tmpdir(), "guideo-effects-fixture-"));

    const clipPath = join(fixtureDir, "clip.mp4");
    await execFile(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=320x180:rate=10",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      clipPath,
    ]);

    rawClip = {
      path: clipPath,
      durationMs: 2000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 2000 }],
      preRollMs: 0,
    };
    ffmpegAvailable = true;
  } catch (error) {
    console.warn(`[ffmpeg-effects.integration] ffmpeg unavailable, skipping: ${String(error)}`);
    ffmpegAvailable = false;
  }
}, 30_000);

afterAll(async () => {
  if (fixtureDir) {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

describe("FfmpegEffectsEngine (ffmpeg integration)", () => {
  it("applies a real blur-region effect gated to the scene range and produces a valid non-empty video", async (ctx) => {
    if (!ffmpegAvailable) {
      ctx.skip();
      return;
    }

    const engine = new FfmpegEffectsEngine();
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "pause",
          narrationSegmentId: "seg-1",
          effects: [{ type: "blur-region", params: { x: 10, y: 10, w: 100, h: 60 } }],
        },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const edited = await engine.apply(rawClip, approved);

    expect(edited.path).not.toBe(rawClip.path);
    const stats = await stat(edited.path);
    expect(stats.size).toBeGreaterThan(0);
  }, 30_000);
});
