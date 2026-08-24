export interface FrameCheckpoint {
  readonly atMs: number;
  readonly bytes: number;
  /** SHA-256 of the decoded PNG checkpoint bytes, not of the source MP4. */
  readonly sha256: string;
}

/** Extracts decoded still frames from a completed video for physical render validation. */
export interface FrameCheckpointProbe {
  capture(videoPath: string, checkpointsMs: readonly number[]): Promise<readonly FrameCheckpoint[]>;
}
