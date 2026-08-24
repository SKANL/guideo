import { artifactManifest, type ArtifactManifest } from "../artifacts/manifest.js";
import { sha256 } from "../artifacts/canonical.js";
import type { SceneClip } from "../ports/scene-splitter.js";

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

/** Process-local cache: artifacts are immutable and keyed by all render-affecting scene inputs. */
export class SceneArtifactCache {
  private readonly artifacts = new Map<string, CachedSceneArtifact>();

  get(key: ArtifactManifest): CachedSceneArtifact | null {
    return this.artifacts.get(key.sha256) ?? null;
  }

  put(key: ArtifactManifest, artifact: CachedSceneArtifact): void {
    this.artifacts.set(key.sha256, artifact);
  }
}
