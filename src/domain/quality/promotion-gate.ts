import type { MediaProbeResult } from "../ports/media-probe.js";
import type { UsageSnapshot, UsageUnit } from "../ports/usage-ledger.js";
import { evaluateQuality, type QualityExpectation, type QualityReport } from "./quality-gate.js";
import { evaluateUx, type UxEvaluationInput, type UxEvaluationReport } from "./ux-evaluation.js";

export interface TimelinePromotionEvidence { readonly expectedSegments: number; readonly actualSegments: number; readonly sceneRanges?: QualityExpectation["sceneRanges"]; readonly motionRanges?: QualityExpectation["motionRanges"]; }
export interface CaptionPromotionEvidence { readonly required: boolean; readonly hasCaptions: boolean; readonly evidence?: NonNullable<QualityExpectation["captionEvidence"]>; }
export interface PromotionInput {
  readonly media: MediaProbeResult;
  readonly quality: Omit<QualityExpectation, "expectedSegments" | "actualSegments" | "sceneRanges" | "motionRanges" | "captionsRequired" | "hasCaptions" | "captionEvidence">;
  readonly timeline: TimelinePromotionEvidence;
  readonly captions: CaptionPromotionEvidence;
  readonly usage: UsageSnapshot;
  readonly ux: UxEvaluationInput;
  /** Synthetic baselines are deterministic controls, never real-user evidence. */
  readonly uxEvidenceSource?: "synthetic-baseline" | "real";
}
export interface PromotionUsageMetrics { readonly spent: number; readonly reserved: number; readonly unit: UsageUnit; readonly cacheHits: number; readonly cacheSavings: number; }
export interface PromotionFailure { readonly source: "quality" | "usage" | "ux"; readonly message: string; }
export interface PromotionReport {
  readonly status: "promoted" | "blocked";
  readonly criticalFailures: readonly PromotionFailure[];
  readonly quality: QualityReport;
  readonly ux: UxEvaluationReport;
  readonly uxEvidenceSource: "synthetic-baseline" | "real";
  readonly usage: PromotionUsageMetrics;
}

/** Deterministic release decision using technical evidence and an explicitly-labelled UX evidence source. */
export function evaluatePromotion(input: PromotionInput): PromotionReport {
  const quality = evaluateQuality(input.media, {
    ...input.quality, expectedSegments: input.timeline.expectedSegments, actualSegments: input.timeline.actualSegments,
    captionsRequired: input.captions.required, hasCaptions: input.captions.hasCaptions,
    ...(input.timeline.sceneRanges === undefined ? {} : { sceneRanges: input.timeline.sceneRanges }),
    ...(input.timeline.motionRanges === undefined ? {} : { motionRanges: input.timeline.motionRanges }),
    ...(input.captions.evidence === undefined ? {} : { captionEvidence: input.captions.evidence }),
  });
  const ux = evaluateUx(input.ux);
  const usage = normalizeUsage(input.usage);
  const criticalFailures: PromotionFailure[] = [...quality.failures.map((message) => ({ source: "quality" as const, message })), ...(usage.reserved === 0 ? [] : [{ source: "usage" as const, message: `usage ledger has ${usage.reserved} ${usage.unit} reserved` }]), ...ux.failures.map((message) => ({ source: "ux" as const, message }))];
  return { status: criticalFailures.length === 0 ? "promoted" : "blocked", criticalFailures, quality, ux, uxEvidenceSource: input.uxEvidenceSource ?? "synthetic-baseline", usage };
}

function normalizeUsage(snapshot: UsageSnapshot): PromotionUsageMetrics {
  const unit = snapshot.unit ?? "usd-micros";
  if (unit !== "usd-micros") throw new Error("promotion usage must use usd-micros");
  const values = { spent: snapshot.spent, reserved: snapshot.reserved, cacheHits: snapshot.cacheHits ?? 0, cacheSavings: snapshot.cacheSavings ?? 0 };
  for (const [name, value] of Object.entries(values)) if (!Number.isSafeInteger(value) || value < 0) throw new Error(`promotion usage ${name} must be a non-negative safe integer`);
  return { ...values, unit };
}
