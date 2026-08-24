import { artifactManifest, type ArtifactManifest } from "../artifacts/manifest.js";
import { sha256 } from "../artifacts/canonical.js";
import type { SceneClip } from "../ports/scene-splitter.js";
import type { ArtifactStore } from "../ports/artifact-store.js";

export const SCENE_ARTIFACT_SCHEMA = "guideo.scene-artifact";
export const SCENE_ARTIFACT_VERSION = 1;

export interface SceneArtifactCacheInput {
  readonly scene: SceneClip;
  readonly effects: readonly unknown[];
  readonly caption: { readonly text: string; readonly startMs: number; readonly durationMs: number } | null;
  readonly renderProfile: unknown;
  readonly intent: string;
}

export interface CachedSceneArtifact {
  readonly ref: ArtifactManifest;
  readonly clip: SceneClip;
}

export function deriveSceneArtifactKey(input: SceneArtifactCacheInput): ArtifactManifest {
  return artifactManifest(SCENE_ARTIFACT_SCHEMA, SCENE_ARTIFACT_VERSION, {
    scene: sha256(input.scene),
    effects: sha256(input.effects),
    caption: sha256(input.caption),
    renderProfile: sha256(input.renderProfile),
    intent: sha256(input.intent),
  });
}

interface PersistedSceneArtifact {
  readonly ref: ArtifactManifest;
  readonly clip: SceneClip;
}

function isSceneClip(value: unknown): value is SceneClip {
  if (typeof value !== "object" || value === null) return false;
  const clip = value as Record<string, unknown>;
  return typeof clip.narrationSegmentId === "string" && typeof clip.path === "string" &&
    typeof clip.durationMs === "number" && Number.isFinite(clip.durationMs) && clip.durationMs >= 0;
}

function isPersistedSceneArtifact(value: unknown, key: ArtifactManifest): value is PersistedSceneArtifact {
  if (typeof value !== "object" || value === null) return false;
  const artifact = value as { ref?: ArtifactManifest; clip?: unknown };
  return artifact.ref?.schema === key.schema && artifact.ref.version === key.version &&
    artifact.ref.sha256 === key.sha256 && isSceneClip(artifact.clip);
}

/** Immutable scene cache with an optional durable backing store for process-independent reuse. */
export class SceneArtifactCache {
  private readonly artifacts = new Map<string, CachedSceneArtifact>();
  constructor(private readonly store?: ArtifactStore) {}

  get(key: ArtifactManifest): CachedSceneArtifact | null {
    return this.artifacts.get(key.sha256) ?? null;
  }

  put(key: ArtifactManifest, artifact: CachedSceneArtifact): void {
    this.artifacts.set(key.sha256, artifact);
  }

  async getOrLoad(key: ArtifactManifest): Promise<CachedSceneArtifact | null> {
    const cached = this.get(key);
    if (cached || !this.store?.loadMaterialization) return cached;
    const bytes = await this.store.loadMaterialization(key);
    if (bytes === null) return null;
    try {
      const artifact: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!isPersistedSceneArtifact(artifact, key)) return null;
      this.put(key, artifact);
      return artifact;
    } catch { return null; }
  }

  async putPersistent(key: ArtifactManifest, artifact: CachedSceneArtifact): Promise<void> {
    this.put(key, artifact);
    if (this.store?.saveMaterialization) await this.store.saveMaterialization(key, new TextEncoder().encode(JSON.stringify(artifact)));
  }
}
