import { artifactManifest, type ArtifactManifest } from "../artifacts/manifest.js";
import { sha256 } from "../artifacts/canonical.js";
import type { SceneClip } from "../ports/scene-splitter.js";
import type { ArtifactStore } from "../ports/artifact-store.js";

export const SCENE_ARTIFACT_SCHEMA = "guideo.scene-artifact";
export const SCENE_ARTIFACT_VERSION = 1;
export const PIPELINE_ARTIFACT_SCHEMA = "guideo.pipeline-artifact";
export const PIPELINE_ARTIFACT_VERSION = 1;

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

export function deriveStageArtifactKey(stage: string, input: unknown): ArtifactManifest {
  return artifactManifest(PIPELINE_ARTIFACT_SCHEMA, PIPELINE_ARTIFACT_VERSION, {
    stage: sha256(stage),
    input: sha256(input),
  });
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

interface PersistedArtifactValue {
  readonly ref: ArtifactManifest;
  readonly value: unknown;
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
  private readonly values = new Map<string, unknown>();
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

  /** Reuses ArtifactStore materializations for every serializable expensive pipeline seam. */
  async getOrLoadValue<T>(key: ArtifactManifest, isValue: (value: unknown) => value is T): Promise<T | null> {
    const cached = this.values.get(key.sha256);
    if (cached !== undefined) return isValue(cached) ? cached : null;
    if (!this.store?.loadMaterialization) return null;
    const bytes = await this.store.loadMaterialization(key);
    if (bytes === null) return null;
    try {
      const persisted = JSON.parse(new TextDecoder().decode(bytes)) as PersistedArtifactValue;
      if (persisted.ref?.schema !== key.schema || persisted.ref.version !== key.version || persisted.ref.sha256 !== key.sha256 || !isValue(persisted.value)) return null;
      this.values.set(key.sha256, persisted.value);
      return persisted.value;
    } catch { return null; }
  }

  async putValuePersistent<T>(key: ArtifactManifest, value: T): Promise<void> {
    this.values.set(key.sha256, value);
    if (this.store?.saveMaterialization) {
      await this.store.saveMaterialization(key, new TextEncoder().encode(JSON.stringify({ ref: key, value } satisfies PersistedArtifactValue)));
    }
  }
}
