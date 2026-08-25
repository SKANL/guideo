import { mkdir, readFile, writeFile } from "node:fs/promises";
import { FfmpegFrameCheckpointProbe } from "../../adapters/media/ffmpeg-frame-checkpoint-probe.js";
import {
  parseRenderProfileName,
  renderProfileViewport,
  type RenderProfileName,
} from "../../domain/models/media.js";
import { parseNarrationMode, type NarrationMode } from "../../domain/models/narration-mode.js";
import { evaluatePromotion, type PromotionReport } from "../../domain/quality/promotion-gate.js";
import type { UxEvaluationInput } from "../../domain/quality/ux-evaluation.js";
import {
  aggregateRealUxEvidence,
  parseRealUxEvidence,
} from "../../domain/quality/real-ux-evidence.js";
import type { FrameCheckpointProbe } from "../../domain/ports/frame-checkpoint-probe.js";
import type { MediaProbe } from "../../domain/ports/media-probe.js";
import type { UsageLedger } from "../../domain/ports/usage-ledger.js";
import { parseScript } from "../../domain/models/script.js";
import { type GuideoPaths, renderArtifactPaths } from "../paths.js";
import {
  renderCheckpointReport,
  type RenderCheckpointReport,
} from "../validation/render-checkpoint-report.js";
import {
  validatePhysicalRender,
  type PhysicalRenderValidationResult,
} from "../validation/physical-render-validator.js";

const TECHNICAL_UX: UxEvaluationInput = {
  targetComprehension: 1,
  resultComprehension: 1,
  captionDistraction: 0,
  professionalismTrust: 1,
  retentionProxy: 1,
} as const;
const FRAME_CHECKPOINT_ENDPOINT_LEAD_MS = 100;
type UxEvidenceStatus = "not-provided" | "ignored-synthetic" | "real";
export interface ValidateRenderInput {
  readonly paths: GuideoPaths;
  readonly profile: RenderProfileName;
  readonly narration: NarrationMode;
  readonly uxEvidencePath?: string;
}
export interface ValidateRenderDependencies {
  readonly mediaProbe: MediaProbe;
  readonly usageLedger: UsageLedger;
  readonly frameProbe?: FrameCheckpointProbe;
}
export interface ValidationReport {
  readonly status: "passed" | "failed";
  readonly physical: PhysicalRenderValidationResult;
  readonly promotion: PromotionReport;
  readonly uxEvidence: {
    readonly status: UxEvidenceStatus;
    readonly path?: string;
    readonly sessions?: number;
    readonly source?: string;
  };
}

/** Validates an existing render from persisted inputs without creating a synthetic UX claim. */
export async function runValidate(
  dependencies: ValidateRenderDependencies,
  input: ValidateRenderInput,
): Promise<ValidationReport> {
  const paths = renderArtifactPaths(input.paths, input.profile, input.narration);
  const script = parseScript(JSON.parse(await readFile(paths.scriptPath, "utf8")));
  const plannedDurationMs = script.segments.reduce(
    (total, segment) => total + segment.timing.durationMs,
    0,
  );
  const checkpointsMs = [
    ...new Set([
      0,
      Math.floor(plannedDurationMs / 2),
      Math.max(0, plannedDurationMs - FRAME_CHECKPOINT_ENDPOINT_LEAD_MS),
    ]),
  ];
  const physical = await validatePhysicalRender({
    request: {
      videoPath: paths.outputPath,
      srtPath: paths.captionsPath,
      profile: input.profile,
      narration: input.narration,
      plannedDurationMs,
      checkpointsMs,
    },
    mediaProbe: dependencies.mediaProbe,
    frameProbe: dependencies.frameProbe ?? new FfmpegFrameCheckpointProbe(),
    readText: (path) => readFile(path, "utf8"),
  });
  const ux = await readUxEvidence(input.uxEvidencePath);
  const usage = await dependencies.usageLedger.snapshot();
  const viewport = renderProfileViewport(input.profile);
  const promotion = evaluatePromotion({
    media: physical.metadata,
    quality: {
      expectedDurationMs: plannedDurationMs,
      expectedVideoCodec: "h264",
      minimumWidth: viewport.width,
      minimumHeight: viewport.height,
      narration: input.narration,
    },
    timeline: { expectedSegments: script.segments.length, actualSegments: script.segments.length },
    captions: {
      required: true,
      hasCaptions: physical.failures.every((failure) => !failure.includes("captions")),
    },
    usage,
    ux: ux.metrics ?? TECHNICAL_UX,
    uxEvidenceSource: ux.status === "real" ? "real" : "synthetic-baseline",
  });
  const technicalFailure =
    !physical.ok || promotion.criticalFailures.some((failure) => failure.source !== "ux");
  const report: ValidationReport = {
    status: technicalFailure ? "failed" : "passed",
    physical,
    promotion,
    uxEvidence:
      ux.status === "not-provided"
        ? { status: ux.status }
        : {
            status: ux.status,
            path: input.uxEvidencePath!,
            ...(ux.sessions === undefined ? {} : { sessions: ux.sessions, source: ux.source }),
          },
  };
  const checkpoint: RenderCheckpointReport = renderCheckpointReport({
    profile: input.profile,
    narration: input.narration,
    physical,
  });
  await mkdir(paths.guideoDir, { recursive: true });
  await Promise.all([
    writeFile(paths.validationReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(paths.checkpointReportPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8"),
  ]);
  return report;
}

async function readUxEvidence(path: string | undefined): Promise<{
  readonly status: UxEvidenceStatus;
  readonly metrics?: UxEvaluationInput;
  readonly sessions?: number;
  readonly source?: string;
}> {
  if (!path) return { status: "not-provided" };
  const value = JSON.parse(await readFile(path, "utf8")) as {
    readonly kind?: unknown;
  };
  if (value.kind !== "real") return { status: "ignored-synthetic" };
  const aggregate = aggregateRealUxEvidence(parseRealUxEvidence(value));
  return {
    status: "real",
    metrics: aggregate.metrics,
    sessions: aggregate.sessions,
    source: parseRealUxEvidence(value).source.system,
  };
}
export function parseValidateRenderProfile(value: string | undefined): RenderProfileName {
  return parseRenderProfileName(value ?? "youtube");
}
export function parseValidateNarration(value: string | undefined): NarrationMode {
  return parseNarrationMode(value ?? "both");
}
