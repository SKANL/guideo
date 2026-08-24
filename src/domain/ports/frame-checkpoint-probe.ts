export interface FrameCheckpoint {
  readonly atMs: number;
  readonly bytes: number;
}

/** Extracts decoded still frames from a completed video for physical render validation. */
export interface FrameCheckpointProbe {
  capture(videoPath: string, checkpointsMs: readonly number[]): Promise<readonly FrameCheckpoint[]>;
}
