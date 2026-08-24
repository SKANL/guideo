import { join } from "node:path";
import type { RenderProfileName } from "../domain/models/media.js";
import type { NarrationMode } from "../domain/models/narration-mode.js";

export interface GuideoPaths {
  readonly guideoDir: string;
  readonly flowGraphPath: string;
  readonly flowGraphCachePath: string;
  readonly capabilityProfilePath: string;
  readonly discoveryObservationPlanPath: string;
  readonly scriptPath: string;
  readonly storyboardPath: string;
  readonly approvalManifestPath: string;
  readonly captionsPath: string;
  readonly outputPath: string;
  readonly validationReportPath: string;
  readonly checkpointReportPath: string;
  readonly physicalRenderMatrixReportPath: string;
}

/** Isolates non-legacy render variants while retaining the original youtube/both file names. */
export function renderArtifactPaths(
  paths: GuideoPaths,
  profile: RenderProfileName = "youtube",
  narration: NarrationMode = "both",
): GuideoPaths {
  if (profile === "youtube" && narration === "both") return paths;
  const label = `${profile}-${narration}`;
  const outputDir = join(paths.guideoDir, "output");
  return {
    ...paths,
    outputPath: join(outputDir, `${label}.mp4`),
    captionsPath: join(outputDir, `${label}.srt`),
    validationReportPath: join(outputDir, `${label}.validation-report.json`),
    checkpointReportPath: join(outputDir, `${label}.checkpoint-report.json`),
  };
}

export function projectPaths(opts: {
  readonly project: string;
  readonly platform?: string;
  readonly renderProfile?: RenderProfileName;
  readonly narration?: NarrationMode;
  readonly cwd?: string;
}): GuideoPaths {
  const cwd = opts.cwd ?? process.cwd();
  const platform = opts.platform ?? "youtube";
  const guideoDir = join(cwd, ".guideo", "projects", opts.project);
  const outputDir = join(guideoDir, "output");
  const base: GuideoPaths = {
    guideoDir,
    flowGraphPath: join(guideoDir, "flow-graph.json"),
    flowGraphCachePath: join(guideoDir, "flow-graph-cache.json"),
    capabilityProfilePath: join(guideoDir, "capability-profile.json"),
    discoveryObservationPlanPath: join(guideoDir, "discovery-observation-plan.json"),
    scriptPath: join(guideoDir, "script.json"),
    storyboardPath: join(guideoDir, "storyboard.json"),
    approvalManifestPath: join(guideoDir, "approval-manifest.json"),
    captionsPath: join(guideoDir, "captions.srt"),
    outputPath: join(outputDir, `${platform}.mp4`),
    validationReportPath: join(guideoDir, "validation-report.json"),
    checkpointReportPath: join(outputDir, "youtube-both.checkpoint-report.json"),
    physicalRenderMatrixReportPath: join(guideoDir, "physical-render-matrix-report.json"),
  };
  return opts.renderProfile
    ? renderArtifactPaths(base, opts.renderProfile, opts.narration ?? "both")
    : base;
}
