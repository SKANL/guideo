import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FfmpegFrameCheckpointProbe } from "../../adapters/media/ffmpeg-frame-checkpoint-probe.js";
import { parseRenderProfileName, renderProfileViewport, type RenderProfileName } from "../../domain/models/media.js";
import { parseNarrationMode, type NarrationMode } from "../../domain/models/narration-mode.js";
import { evaluatePromotion, type PromotionReport } from "../../domain/quality/promotion-gate.js";
import type { FrameCheckpointProbe } from "../../domain/ports/frame-checkpoint-probe.js";
import type { MediaProbe } from "../../domain/ports/media-probe.js";
import type { UsageLedger } from "../../domain/ports/usage-ledger.js";
import { parseScript } from "../../domain/models/script.js";
import type { GuideoPaths } from "../paths.js";
import { validatePhysicalRender, type PhysicalRenderValidationResult } from "../validation/physical-render-validator.js";

const TECHNICAL_UX = {
  targetComprehension: 1,
  resultComprehension: 1,
  captionDistraction: 0,
  professionalismTrust: 1,
  retentionProxy: 1,
} as const;

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
  readonly uxEvidence: { readonly status: UxEvidenceStatus; readonly path?: string };
}

/** Validates an existing render from persisted inputs without creating a synthetic UX claim. */
export async function runValidate(
  dependencies: ValidateRenderDependencies,
  input: ValidateRenderInput,
): Promise<ValidationReport> {
  const script = parseScript(JSON.parse(await readFile(input.paths.scriptPath, "utf8")));
  const plannedDurationMs = script.segments.reduce((total, segment) => total + segment.timing.durationMs, 0);
  const checkpointsMs = [...new Set([0, Math.floor(plannedDurationMs / 2), Math.max(0, plannedDurationMs - 1)])];
  const physical = await validatePhysicalRender({
    request: { videoPath: input.paths.outputPath, srtPath: input.paths.captionsPath, profile: input.profile, narration: input.narration, plannedDurationMs, checkpointsMs },
    mediaProbe: dependencies.mediaProbe,
    frameProbe: dependencies.frameProbe ?? new FfmpegFrameCheckpointProbe(),
    readText: (path) => readFile(path, "utf8"),
  });
  const ux = await readUxEvidence(input.uxEvidencePath);
  const usage = await dependencies.usageLedger.snapshot();
  const viewport = renderProfileViewport(input.profile);
  const promotion = evaluatePromotion({
    media: physical.metadata,
    quality: { expectedDurationMs: plannedDurationMs, expectedVideoCodec: "h264", minimumWidth: viewport.width, minimumHeight: viewport.height, narration: input.narration },
    timeline: { expectedSegments: script.segments.length, actualSegments: script.segments.length },
    captions: { required: true, hasCaptions: physical.failures.every((failure) => !failure.includes("captions")) },
    usage,
    ux: ux.metrics ?? TECHNICAL_UX,
  });
  const technicalFailure = !physical.ok || promotion.criticalFailures.some((failure) => failure.source !== "ux");
  const report: ValidationReport = { status: technicalFailure ? "failed" : "passed", physical, promotion, uxEvidence: ux.status === "not-provided" ? { status: ux.status } : { status: ux.status, path: input.uxEvidencePath! } };
  await mkdir(input.paths.guideoDir, { recursive: true });
  await writeFile(join(input.paths.guideoDir, "validation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function readUxEvidence(path: string | undefined): Promise<{ readonly status: UxEvidenceStatus; readonly metrics?: typeof TECHNICAL_UX }> {
  if (!path) return { status: "not-provided" };
  const value = JSON.parse(await readFile(path, "utf8")) as { readonly kind?: unknown } & typeof TECHNICAL_UX;
  if (value.kind !== "real") return { status: "ignored-synthetic" };
  return { status: "real", metrics: { targetComprehension: value.targetComprehension, resultComprehension: value.resultComprehension, captionDistraction: value.captionDistraction, professionalismTrust: value.professionalismTrust, retentionProxy: value.retentionProxy } };
}

export function parseValidateRenderProfile(value: string | undefined): RenderProfileName {
  return parseRenderProfileName(value ?? "youtube");
}

export function parseValidateNarration(value: string | undefined): NarrationMode {
  return parseNarrationMode(value ?? "both");
}
