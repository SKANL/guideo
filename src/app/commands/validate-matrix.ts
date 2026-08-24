import { mkdir, writeFile } from "node:fs/promises";
import type { NarrationMode } from "../../domain/models/narration-mode.js";
import type { RenderProfileName } from "../../domain/models/media.js";
import type { GuideoPaths } from "../paths.js";
import { renderArtifactPaths } from "../paths.js";
import { PHYSICAL_RENDER_VALIDATION_MATRIX } from "../validation/physical-render-matrix.js";
import { runValidate, type ValidateRenderDependencies, type ValidationReport } from "./validate.js";

export interface PhysicalRenderMatrixArtifact {
  readonly schema: "guideo.physical-render-matrix-artifact";
  readonly version: 1;
  readonly status: "passed" | "failed";
  readonly scenarios: readonly {
    readonly id: string;
    readonly profile: RenderProfileName;
    readonly narration: NarrationMode;
    readonly outputPath: string;
    readonly captionsPath: string;
    readonly checkpointReportPath: string;
    readonly validationStatus: "passed" | "failed";
    readonly failures: readonly string[];
  }[];
}

/** Generates a deterministic matrix from already-rendered local MP4/SRT variants. */
export async function runValidateMatrix(
  dependencies: ValidateRenderDependencies,
  paths: GuideoPaths,
): Promise<PhysicalRenderMatrixArtifact> {
  const scenarios: PhysicalRenderMatrixArtifact["scenarios"][number][] = [];
  for (const scenario of PHYSICAL_RENDER_VALIDATION_MATRIX) {
    const variantPaths = renderArtifactPaths(paths, scenario.profile, scenario.narration);
    try {
      const report: ValidationReport = await runValidate(dependencies, {
        paths,
        profile: scenario.profile,
        narration: scenario.narration,
      });
      scenarios.push({
        id: scenario.id,
        profile: scenario.profile,
        narration: scenario.narration,
        outputPath: variantPaths.outputPath,
        captionsPath: variantPaths.captionsPath,
        checkpointReportPath: variantPaths.checkpointReportPath,
        validationStatus: report.status,
        failures: report.physical.failures,
      });
    } catch (error) {
      scenarios.push({
        id: scenario.id,
        profile: scenario.profile,
        narration: scenario.narration,
        outputPath: variantPaths.outputPath,
        captionsPath: variantPaths.captionsPath,
        checkpointReportPath: variantPaths.checkpointReportPath,
        validationStatus: "failed",
        failures: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  const artifact: PhysicalRenderMatrixArtifact = {
    schema: "guideo.physical-render-matrix-artifact",
    version: 1,
    status: scenarios.every((scenario) => scenario.validationStatus === "passed")
      ? "passed"
      : "failed",
    scenarios,
  };
  await mkdir(paths.guideoDir, { recursive: true });
  await writeFile(
    paths.physicalRenderMatrixReportPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  return artifact;
}
