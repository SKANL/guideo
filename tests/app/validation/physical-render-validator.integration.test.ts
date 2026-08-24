import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFfmpegPath } from "../../../src/adapters/compose/ffmpeg-path.js";
import { FfmpegFrameCheckpointProbe } from "../../../src/adapters/media/ffmpeg-frame-checkpoint-probe.js";
import { FfmpegMediaProbe } from "../../../src/adapters/media/ffmpeg-media-probe.js";
import { validatePhysicalRender } from "../../../src/app/validation/physical-render-validator.js";
import { physicalRenderFixtureRecordingPath, physicalRenderFixtureTargetPath } from "../../fixtures/physical-render-fixture.js";

const execFile = promisify(execFileCallback);
let fixtureRoot = "";
let available = false;

function resolveFfprobePath(): string {
  return resolveFfmpegPath().replace(/ffmpeg(\.exe)?$/i, (match) => match.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe");
}

beforeAll(async () => {
  try {
    await stat(physicalRenderFixtureTargetPath);
    await execFile(resolveFfprobePath(), ["-version"]);
    fixtureRoot = await mkdtemp(join(tmpdir(), "guideo-physical-render-"));
    const recording = physicalRenderFixtureRecordingPath(fixtureRoot);
    await execFile(resolveFfmpegPath(), ["-y", "-f", "lavfi", "-i", "color=c=navy:s=1920x1080:r=2:d=2", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", recording]);
    await writeFile(join(fixtureRoot, "physical-render-fixture.srt"), "1\n00:00:00,000 --> 00:00:01,500\nFixture render\n", "utf8");
    available = true;
  } catch (error) {
    console.warn(`[physical-render-validator.integration] ffmpeg unavailable, skipping: ${String(error)}`);
  }
}, 30_000);

afterAll(async () => { if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }); });

describe("physical render fixture harness", () => {
  it("probes a reproducible local recording without an authenticated target", async (ctx) => {
    if (!available) return ctx.skip();
    const recording = physicalRenderFixtureRecordingPath(fixtureRoot);
    const report = await validatePhysicalRender({
      request: { videoPath: recording, srtPath: join(fixtureRoot, "physical-render-fixture.srt"), profile: "youtube", narration: "both", plannedDurationMs: 1_500, checkpointsMs: [0, 1_000] },
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
});
