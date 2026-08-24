import { access, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { canonicalJson, sha256Bytes } from "../../domain/artifacts/canonical.js";
import { artifactManifest, type ArtifactManifest, type ArtifactRef } from "../../domain/artifacts/manifest.js";
import type { ArtifactStore } from "../../domain/ports/artifact-store.js";
export class FsArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}
  async lookup(key: ArtifactRef): Promise<ArtifactRef | null> { try { const manifest = JSON.parse(await readFile(join(this.root, "manifests", `${key.sha256}.json`), "utf8")) as ArtifactManifest & { contentSha256?: string }; const bytes = await readFile(join(this.root, "blobs", key.sha256)); return manifest.finalized === true && manifest.sha256 === key.sha256 && typeof manifest.contentSha256 === "string" && manifest.contentSha256 === sha256Bytes(bytes) ? { schema: manifest.schema, version: manifest.version, sha256: manifest.sha256, inputs: manifest.inputs } as ArtifactRef : null; } catch { return null; } }
  async finalize(input: AsyncIterable<Uint8Array>, manifest: Omit<ArtifactManifest, "sha256">): Promise<ArtifactRef> { const chunks: Uint8Array[] = []; for await (const chunk of input) chunks.push(chunk); const bytes = Buffer.concat(chunks); const contentSha256 = sha256Bytes(bytes); const ref = artifactManifest(manifest.schema, manifest.version, { ...manifest.inputs, contentSha256 }); await mkdir(join(this.root, "blobs"), { recursive: true }); await mkdir(join(this.root, "manifests"), { recursive: true }); const temp = join(this.root, "blobs", `.${ref.sha256}.${randomUUID()}.tmp`); const handle = await open(temp, "w"); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } const blobPath = join(this.root, "blobs", ref.sha256); try { await rename(temp, blobPath); } catch (error) { const existing = await readFile(blobPath).catch(() => null); if (existing === null || sha256Bytes(existing) !== contentSha256) throw error; await unlink(temp).catch(() => undefined); } const finalized = { ...ref, finalized: true, contentSha256 }; const manifestTemp = join(this.root, "manifests", `.${ref.sha256}.${randomUUID()}.tmp`); await writeFile(manifestTemp, canonicalJson(finalized), "utf8"); try { await rename(manifestTemp, join(this.root, "manifests", `${ref.sha256}.json`)); } catch (error) { await unlink(manifestTemp).catch(() => undefined); if ((await this.lookup(ref)) === null) throw error; } return ref; }
  async quarantine(runId: string, reason: string): Promise<void> { const file = join(this.root, "quarantine", `${runId}.json`); await mkdir(dirname(file), { recursive: true }); await writeFile(file, canonicalJson({ runId, reason }), "utf8"); }
  async saveMaterialization(key: ArtifactRef, bytes: Uint8Array): Promise<void> {
    const dir = join(this.root, "materializations");
    await mkdir(dir, { recursive: true });
    const value = { key, contentSha256: sha256Bytes(bytes), content: Buffer.from(bytes).toString("base64") };
    const target = join(dir, `${key.sha256}.json`);
    const temp = join(dir, `.${key.sha256}.${randomUUID()}.tmp`);
    await writeFile(temp, canonicalJson(value), "utf8");
    try {
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      const existing = await this.loadMaterialization(key);
      if (existing === null || sha256Bytes(existing) !== value.contentSha256) throw error;
    }
  }
  async loadMaterialization(key: ArtifactRef): Promise<Uint8Array | null> {
    const file = join(this.root, "materializations", `${key.sha256}.json`);
    let raw: string;
    try { raw = await readFile(file, "utf8"); } catch { return null; }
    try {
      const value = JSON.parse(raw) as { key?: ArtifactRef; contentSha256?: string; content?: string };
      if (
        value.key?.schema !== key.schema || value.key.version !== key.version || value.key.sha256 !== key.sha256 ||
        typeof value.contentSha256 !== "string" || typeof value.content !== "string"
      ) throw new Error("materialization key or content is invalid");
      const bytes = new Uint8Array(Buffer.from(value.content, "base64"));
      if (sha256Bytes(bytes) !== value.contentSha256) throw new Error("materialization content hash mismatch");
      return bytes;
    } catch {
      const quarantine = join(this.root, "quarantine", `materialization-${key.sha256}-${randomUUID()}.json`);
      await mkdir(dirname(quarantine), { recursive: true });
      await rename(file, quarantine).catch(() => undefined);
      return null;
    }
  }
}


