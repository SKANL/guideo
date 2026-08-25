import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsArtifactStore } from "../../../src/adapters/storage/fs-artifact-store.js";
import { artifactManifest } from "../../../src/domain/artifacts/manifest.js";
import {
  SceneArtifactCache,
  deriveSceneArtifactKey,
  deriveStageArtifactKey,
} from "../../../src/domain/pipeline/scene-artifact-cache.js";

describe("SceneArtifactCache", () => {
  it("returns the exact cached artifact without reprocessing the same key", () => {
    const cache = new SceneArtifactCache();
    const key = deriveSceneArtifactKey({
      scene: { narrationSegmentId: "scene-1", path: "input-1.mp4", durationMs: 1_000 },
      effects: [{ type: "zoom-in", params: { amount: 1.2 } }],
      caption: { text: "Welcome", startMs: 0, durationMs: 1_000 },
      renderProfile: { codec: "h264", crf: 18 },
      intent: "demo",
    });
    const artifact = {
      ref: artifactManifest(key.schema, key.version, key.inputs),
      clip: { narrationSegmentId: "scene-1", path: "edited-1.mp4", durationMs: 1_000 },
    };

    cache.put(key, artifact);

    expect(cache.get(key)).toEqual(artifact);
  });

  it("changes the key when the render intent changes", () => {
    const shared = {
      scene: { narrationSegmentId: "scene-1", path: "input-1.mp4", durationMs: 1_000 },
      effects: [],
      caption: { text: "Welcome", startMs: 0, durationMs: 1_000 },
      renderProfile: { codec: "h264", crf: 18 },
    };

    expect(deriveSceneArtifactKey({ ...shared, intent: "demo" }).sha256)
      .not.toBe(deriveSceneArtifactKey({ ...shared, intent: "tutorial" }).sha256);
  });

  it("rehydrates a reusable pipeline-stage materialization from ArtifactStore", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-stage-cache-"));
    try {
      const key = deriveStageArtifactKey("voice", { segment: "s1", text: "Welcome" });
      await new SceneArtifactCache(new FsArtifactStore(root)).putValuePersistent(key, { path: "s1.mp3" });
      const loaded = await new SceneArtifactCache(new FsArtifactStore(root)).getOrLoadValue(
        key,
        (value): value is { path: string } => typeof value === "object" && value !== null && typeof (value as { path?: unknown }).path === "string",
      );
      expect(loaded).toEqual({ path: "s1.mp3" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
