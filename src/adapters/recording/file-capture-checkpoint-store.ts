import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CaptureCheckpoint, RawClip } from "../../domain/models/media.js";
import type { CaptureCheckpointStore } from "../../domain/ports/recording-engine.js";

type StoredState = { readonly checkpoint: CaptureCheckpoint; readonly finalized?: RawClip };

export class FileCaptureCheckpointStore implements CaptureCheckpointStore {
  constructor(private readonly root: string) {}
  async load(inputSha256: string): Promise<StoredState | null> {
    try {
      const state = JSON.parse(await readFile(this.path(inputSha256), "utf8")) as StoredState;
      return state.checkpoint.inputSha256 === inputSha256 ? state : null;
    } catch { return null; }
  }
  async save(checkpoint: CaptureCheckpoint): Promise<void> {
    const existing = await this.load(checkpoint.inputSha256);
    await this.write(checkpoint.inputSha256, { checkpoint, ...(existing?.finalized ? { finalized: existing.finalized } : {}) });
  }
  async finalize(inputSha256: string, clip: RawClip): Promise<void> {
    const existing = await this.load(inputSha256);
    if (!existing) throw new Error("cannot finalize capture without a matching durable checkpoint");
    await this.write(inputSha256, { checkpoint: existing.checkpoint, finalized: clip });
  }
  private path(inputSha256: string): string { return join(this.root, `${inputSha256}.json`); }
  private async write(inputSha256: string, state: StoredState): Promise<void> {
    const target = this.path(inputSha256); const temp = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true }); await writeFile(temp, JSON.stringify(state), "utf8"); await rename(temp, target);
  }
}
