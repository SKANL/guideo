import { describe, expect, it } from "vitest";
import { artifactManifest } from "../../../src/domain/artifacts/manifest.js";
import {
  SceneArtifactCache,
  deriveSceneArtifactKey,
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
});
