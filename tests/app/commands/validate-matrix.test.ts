import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runValidateMatrix } from "../../../src/app/commands/validate-matrix.js";
import { projectPaths, renderArtifactPaths } from "../../../src/app/paths.js";
import { PHYSICAL_RENDER_VALIDATION_MATRIX } from "../../../src/app/validation/physical-render-matrix.js";

let scratch = "";
afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe("runValidateMatrix", () => {
  it("writes a deterministic local-render matrix artifact without an authenticated target", async () => {
    scratch = await mkdtemp(join(tmpdir(), "guideo-render-matrix-"));
    const paths = projectPaths({ project: "fixture", cwd: scratch });
    await mkdir(paths.guideoDir, { recursive: true });
    await writeFile(
      paths.scriptPath,
      JSON.stringify({
        segments: [{ id: "fixture", text: "Fixture", timing: { startMs: 0, durationMs: 1000 } }],
      }),
    );
    for (const scenario of PHYSICAL_RENDER_VALIDATION_MATRIX) {
      const variant = renderArtifactPaths(paths, scenario.profile, scenario.narration);
      await mkdir(join(variant.guideoDir, "output"), { recursive: true });
      await writeFile(variant.outputPath, "local fixture media");
      await writeFile(variant.captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nFixture\n");
    }
    const artifact = await runValidateMatrix(
      {
        mediaProbe: {
          probe: async (path) => {
            const scenario = PHYSICAL_RENDER_VALIDATION_MATRIX.find(({ id }) =>
              path.includes(`${id}.mp4`),
            );
            if (!scenario)
              return {
                durationMs: 1000,
                hasVideo: true,
                hasAudio: true,
                videoCodec: "h264",
                width: 1920,
                height: 1080,
              };
            return {
              durationMs: 1000,
              hasVideo: true,
              hasAudio: scenario.hasAudio,
              videoCodec: "h264",
              width: scenario.width,
              height: scenario.height,
            };
          },
        },
        frameProbe: {
          capture: async (_path, checkpoints) =>
            checkpoints.map((atMs) => ({ atMs, bytes: 9, sha256: "fixture-frame" })),
        },
        usageLedger: {
          reserve: async () => {
            throw new Error("unused");
          },
          commit: async () => undefined,
          release: async () => undefined,
          snapshot: async () => ({ spent: 0, reserved: 0 }),
        },
      },
      paths,
    );
    expect(artifact.status).toBe("passed");
    expect(artifact.scenarios).toHaveLength(9);
    expect(JSON.parse(await readFile(paths.physicalRenderMatrixReportPath, "utf8"))).toMatchObject({
      schema: "guideo.physical-render-matrix-artifact",
      status: "passed",
    });
  });
});
