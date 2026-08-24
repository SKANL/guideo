import type { FrameCheckpoint } from "../../domain/ports/frame-checkpoint-probe.js";
import type { NarrationMode } from "../../domain/models/narration-mode.js";
import type { RenderProfileName } from "../../domain/models/media.js";
import type { PhysicalRenderValidationResult } from "./physical-render-validator.js";

export interface RenderCheckpointReport {
  readonly schema: "guideo.render-checkpoint-report";
  readonly version: 1;
  readonly profile: RenderProfileName;
  readonly narration: NarrationMode;
  readonly validation: {
    readonly status: "passed" | "failed";
    readonly failures: readonly string[];
  };
  readonly checkpoints: readonly FrameCheckpoint[];
}

/** Keeps the real-output visual evidence deterministic and free of wall-clock values. */
export function renderCheckpointReport(input: {
  readonly profile: RenderProfileName;
  readonly narration: NarrationMode;
  readonly physical: PhysicalRenderValidationResult;
}): RenderCheckpointReport {
  return {
    schema: "guideo.render-checkpoint-report",
    version: 1,
    profile: input.profile,
    narration: input.narration,
    validation: { status: input.physical.status, failures: input.physical.failures },
    checkpoints: input.physical.checkpoints,
  };
}
