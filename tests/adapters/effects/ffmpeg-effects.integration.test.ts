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
import type { SceneClip } from "../../../src/domain/ports/scene-splitter.js";
import { review } from "../../../src/domain/review-gate.js";

const execFile = promisify(execFileCb);

// Real integration test: actually invokes the resolved ffmpeg binary end-to-end, applying a real
// ANIMATED zoom-in effect gated to ONE synthetic scene clip's own timeline (per-scene-clip
// architecture). Skipped (not failed) if ffmpeg cannot run in this sandbox — the argv-safety +
// filter-builder + effects-graph unit tests remain the hard gate regardless (same pattern as
// youtube-profile.integration.test.ts).
let ffmpegAvailable = false;
let fixtureDir: string;
let rawClip: RawClip;
let sceneClip: SceneClip;

beforeAll(async () => {
  try {
    const ffmpegPath = resolveFfmpegPath();
    fixtureDir = await mkdtemp(join(tmpdir(), "guideo-scene-effects-fixture-"));

    const scenePath = join(fixtureDir, "scene-0.mp4");
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
      scenePath,
    ]);

    // The pre-split RawClip is only consulted for storyboard/resolvedEffects context — its own
    // `path` is never opened by applyToScenes (each scene clip's OWN path is).
    rawClip = {
      path: "unused.mp4",
      durationMs: 2000,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 2000 }],
      preRollMs: 0,
    };
    sceneClip = { narrationSegmentId: "seg-1", path: scenePath, durationMs: 2000 };
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

describe("FfmpegEffectsEngine.applyToScenes (ffmpeg integration)", () => {
  it("applies a real ANIMATED zoom-in gated to a region and to the scene clip's OWN timeline, producing a valid non-empty video", async (ctx) => {
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
          effects: [{ type: "zoom-in", params: { x: 20, y: 20, w: 80, h: 60, level: 1.4 } }],
        },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval");

    const [edited] = await engine.applyToScenes(rawClip, [sceneClip], approved);

    expect(edited).toBeDefined();
    expect(edited?.path).not.toBe(sceneClip.path);
    expect(edited?.narrationSegmentId).toBe("seg-1");
    expect(edited?.durationMs).toBe(2000);
    const stats = await stat((edited as SceneClip).path);
    expect(stats.size).toBeGreaterThan(0);
  }, 30_000);
});
