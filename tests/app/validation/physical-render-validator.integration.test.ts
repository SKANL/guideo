import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFfmpegPath } from "../../../src/adapters/compose/ffmpeg-path.js";
import { FfmpegFrameCheckpointProbe } from "../../../src/adapters/media/ffmpeg-frame-checkpoint-probe.js";
import { FfmpegMediaProbe } from "../../../src/adapters/media/ffmpeg-media-probe.js";
import { resolveFfprobePath } from "../../../src/adapters/media/ffprobe-path.js";
import { PHYSICAL_RENDER_VALIDATION_MATRIX } from "../../../src/app/validation/physical-render-matrix.js";
import { validatePhysicalRender } from "../../../src/app/validation/physical-render-validator.js";
import { physicalRenderFixtureRecordingPath } from "../../fixtures/physical-render-fixture.js";

const execFile = promisify(execFileCallback);
let fixtureRoot = "";
let available = false;

async function createRecording(
  id: string,
  width: number,
  height: number,
  hasAudio: boolean,
): Promise<string> {
  const recording = physicalRenderFixtureRecordingPath(fixtureRoot).replace(
    "fixture.mp4",
    `${id}.mp4`,
  );
  const args = ["-y", "-f", "lavfi", "-i", `color=c=navy:s=${width}x${height}:r=2:d=2`];
  if (hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-shortest");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (hasAudio) args.push("-c:a", "aac");
  args.push(recording);
  await execFile(resolveFfmpegPath(), args);
  return recording;
}

beforeAll(async () => {
  try {
    await execFile(resolveFfprobePath(), ["-version"]);
    fixtureRoot = await mkdtemp(join(tmpdir(), "guideo-physical-render-"));
    await stat(fixtureRoot);
    await writeFile(
      join(fixtureRoot, "physical-render-fixture.srt"),
      "1\n00:00:00,000 --> 00:00:01,500\nFixture render\n",
      "utf8",
    );
    available = true;
  } catch (error) {
    console.warn(
      `[physical-render-validator.integration] ffmpeg unavailable, skipping: ${String(error)}`,
    );
  }
}, 30_000);

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe("physical render fixture matrix", () => {
  for (const scenario of PHYSICAL_RENDER_VALIDATION_MATRIX) {
    it(`probes ${scenario.id} without an authenticated target`, async (ctx) => {
      if (!available) return ctx.skip();
      const recording = await createRecording(
        scenario.id,
        scenario.width,
        scenario.height,
        scenario.hasAudio,
      );
      const report = await validatePhysicalRender({
        request: {
          videoPath: recording,
          srtPath: join(fixtureRoot, "physical-render-fixture.srt"),
          profile: scenario.profile,
          narration: scenario.narration,
          plannedDurationMs: 1_500,
          checkpointsMs: [0, 1_000],
        },
        mediaProbe: new FfmpegMediaProbe(async (_binary, argv) => {
          const result = await execFile(resolveFfprobePath(), [...argv], { encoding: "utf8" });
          return { stdout: result.stdout, stderr: result.stderr };
        }),
        frameProbe: new FfmpegFrameCheckpointProbe(),
        readText: async (path) => (await import("node:fs/promises")).readFile(path, "utf8"),
      });
      expect(report.status).toBe("passed");
      expect(report.failures).toEqual([]);
    }, 30_000);
  }
});
