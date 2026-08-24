import type { ArtifactManifest, ArtifactRef } from "../artifacts/manifest.js";

export interface ArtifactStore {
  lookup(key: ArtifactRef): Promise<ArtifactRef | null>;
  finalize(input: AsyncIterable<Uint8Array>, manifest: Omit<ArtifactManifest, "sha256">): Promise<ArtifactRef>;
  quarantine(runId: string, reason: string): Promise<void>;
  /** Stores a materializable, serialized value under the caller's canonical artifact hash. */
  saveMaterialization?(key: ArtifactRef, bytes: Uint8Array): Promise<void>;
  /** Loads a materialized value only when its key and content integrity both validate. */
  loadMaterialization?(key: ArtifactRef): Promise<Uint8Array | null>;
}
