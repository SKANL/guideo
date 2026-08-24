import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsArtifactStore } from "../../../src/adapters/storage/fs-artifact-store.js";
const bytes = async function* () { yield new TextEncoder().encode("artifact"); };
describe("FsArtifactStore", () => {
  it("finalizes atomically, only looks up finalized artifacts, and quarantines abandoned data", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-store-"));
    try {
      const store = new FsArtifactStore(root);
      const ref = await store.finalize(bytes(), { schema: "script", version: 2, inputs: { script: "abc" } });
      expect(await store.lookup(ref)).toEqual(ref);
      await store.quarantine("run-1", "interrupted");
      expect(await readFile(join(root, "quarantine", "run-1.json"), "utf8")).toContain("interrupted");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("uses independent temp files for concurrent finalization and rejects a finalized manifest without its blob", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-store-"));
    try {
      const store = new FsArtifactStore(root);
      const [first, second] = await Promise.all([
        store.finalize(bytes(), { schema: "script", version: 2, inputs: { script: "abc" } }),
        store.finalize(bytes(), { schema: "script", version: 2, inputs: { script: "abc" } }),
      ]);
      expect(first).toEqual(second);
      await rm(join(root, "blobs", first.sha256));
      expect(await store.lookup(first)).toBeNull();
      await writeFile(join(root, "manifests", `${first.sha256}.json`), "{ bad json", "utf8");
      expect(await store.lookup(first)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("binds each reference to its exact bytes and rejects a corrupted blob", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-store-"));
    try {
      const store = new FsArtifactStore(root);
      const first = await store.finalize(bytes(), { schema: "script", version: 2, inputs: { script: "abc" } });
      const second = await store.finalize(
        (async function* () { yield new TextEncoder().encode("different artifact"); })(),
        { schema: "script", version: 2, inputs: { script: "abc" } },
      );

      expect(second.sha256).not.toBe(first.sha256);
      await writeFile(join(root, "blobs", first.sha256), "corrupted", "utf8");
      expect(await store.lookup(first)).toBeNull();
      expect(await store.lookup(second)).toEqual(second);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
