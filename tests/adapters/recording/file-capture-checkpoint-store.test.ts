import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCaptureCheckpointStore } from "../../../src/adapters/recording/file-capture-checkpoint-store.js";

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe("FileCaptureCheckpointStore", () => {
  it("persists canonical-input checkpoints and replays only a finalized matching raw clip", async () => {
    root = await mkdtemp(join(tmpdir(), "guideo-checkpoint-"));
    const store = new FileCaptureCheckpointStore(root);
    await store.save({ runId: "run-1", inputSha256: "input-a", completedStepIndex: 0, url: "https://app.test/a" });
    await store.finalize("input-a", { path: "capture.webm", durationMs: 1000, aspectRatio: "16:9", scenes: [], preRollMs: 0 });

    await expect(store.load("input-a")).resolves.toMatchObject({ checkpoint: { runId: "run-1", completedStepIndex: 0 }, finalized: { path: "capture.webm" } });
    await expect(store.load("different-input")).resolves.toBeNull();
  });
});
