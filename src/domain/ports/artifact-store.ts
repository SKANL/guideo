import type { ArtifactManifest, ArtifactRef } from "../artifacts/manifest.js";
export interface ArtifactStore { lookup(key: ArtifactRef): Promise<ArtifactRef | null>; finalize(input: AsyncIterable<Uint8Array>, manifest: Omit<ArtifactManifest, "sha256">): Promise<ArtifactRef>; quarantine(runId: string, reason: string): Promise<void>; }
