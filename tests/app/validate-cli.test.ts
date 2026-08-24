import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Container } from "../../src/app/factory.js";
import { projectPaths } from "../../src/app/paths.js";
import { runCli } from "../../src/app/run.js";
import type { MediaProbeResult } from "../../src/domain/ports/media-probe.js";
import type { FrameCheckpointProbe } from "../../src/domain/ports/frame-checkpoint-probe.js";

let scratchDir = "";

afterEach(async () => { if (scratchDir) await rm(scratchDir, { recursive: true, force: true }); });

function validationContainer(metadata: MediaProbeResult): Container {
  return {
    mediaProbe: { probe: async () => metadata },
    usageLedger: { reserve: async () => { throw new Error("unused"); }, commit: async () => undefined, release: async () => undefined, snapshot: async () => ({ spent: 0, reserved: 0 }) },
    frameProbe: { capture: async (_videoPath: string, checkpointsMs: readonly number[]) => checkpointsMs.map((atMs) => ({ atMs, bytes: 42 })) } satisfies FrameCheckpointProbe,
  } as unknown as Container;
}

async function writeRenderInputs(cwd: string): Promise<{ readonly paths: ReturnType<typeof projectPaths>; readonly uxPath: string }> {
  const paths = projectPaths({ project: "acme", cwd });
  await mkdir(join(paths.guideoDir, "output"), { recursive: true });
  await writeFile(paths.outputPath, "not-read-by-fake-probe", { encoding: "utf8", flush: true });
  await writeFile(paths.captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nHello\n", { encoding: "utf8", flush: true });
  await writeFile(paths.scriptPath, JSON.stringify({ segments: [{ id: "intro", text: "Hello", timing: { startMs: 0, durationMs: 1_000 } }] }), { encoding: "utf8", flush: true });
  const uxPath = join(paths.guideoDir, "synthetic-ux.json");
  await writeFile(uxPath, JSON.stringify({ kind: "synthetic", targetComprehension: 0, resultComprehension: 0, captionDistraction: 1, professionalismTrust: 0, retentionProxy: 0 }), "utf8");
  return { paths, uxPath };
}

describe("guideo validate", () => {
  it("rejects an invalid validation profile before reading render artifacts", async () => {
    const errors: string[] = [];

    const code = await runCli(
      ["validate", "--profile", "portrait"],
      {} as Container,
      process.cwd(),
      () => undefined,
      (line) => errors.push(line),
    );

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/Invalid --profile value "portrait"/);
  });

  it("parses render arguments, writes a deterministic report, and ignores synthetic UX evidence", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-validate-"));
    const { paths, uxPath } = await writeRenderInputs(scratchDir);
    const lines: string[] = [];
    const errors: string[] = [];

    const code = await runCli(
      ["validate", "--project", "acme", "--profile", "youtube", "--narration", "both", "--ux-evidence", uxPath],
      validationContainer({ durationMs: 1_000, hasVideo: true, hasAudio: true, videoCodec: "h264", width: 1920, height: 1080 }),
      scratchDir,
      (line) => lines.push(line),
      (line) => errors.push(line),
    );

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(lines).toEqual([`Validation report written to ${join(paths.guideoDir, "validation-report.json")}`]);
    const report = JSON.parse(await readFile(join(paths.guideoDir, "validation-report.json"), "utf8"));
    expect(report).toMatchObject({ status: "passed", uxEvidence: { status: "ignored-synthetic" }, physical: { status: "passed" }, promotion: { status: "promoted" } });
  });

  it("writes a report and exits nonzero for a technical render failure", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-validate-failure-"));
    const { paths } = await writeRenderInputs(scratchDir);

    const code = await runCli(
      ["validate", "--project", "acme", "--profile", "youtube", "--narration", "both"],
      validationContainer({ durationMs: 1_000, hasVideo: false, hasAudio: true, videoCodec: "h264", width: 1920, height: 1080 }),
      scratchDir,
      () => undefined,
      () => undefined,
    );

    expect(code).toBe(1);
    await expect(readFile(join(paths.guideoDir, "validation-report.json"), "utf8")).resolves.toContain('"status": "failed"');
  });
});
