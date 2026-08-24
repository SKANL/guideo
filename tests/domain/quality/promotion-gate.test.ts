import { describe, expect, it } from "vitest";
import { evaluatePromotion } from "../../../src/domain/quality/promotion-gate.js";

const input = {
  media: { durationMs: 3_000, hasVideo: true, hasAudio: false },
  quality: { expectedDurationMs: 3_000, narration: "silent" as const },
  timeline: { expectedSegments: 1, actualSegments: 1 },
  captions: { required: false, hasCaptions: false },
  usage: { spent: 12, reserved: 0, unit: "usd-micros" as const, cacheHits: 2, cacheSavings: 9 },
  ux: { targetComprehension: 0.9, resultComprehension: 0.9, captionDistraction: 0.1, professionalismTrust: 0.9, retentionProxy: 0.8 },
};

describe("promotion gate", () => {
  it("promotes only when media, timeline, captions, usage, and UX evidence pass", () => {
    expect(evaluatePromotion(input)).toEqual({
      status: "promoted", criticalFailures: [], quality: { status: "passed", failures: [] },
      ux: { status: "passed", score: 0.88, failures: [] },
      uxEvidenceSource: "synthetic-baseline",
      usage: { spent: 12, reserved: 0, unit: "usd-micros", cacheHits: 2, cacheSavings: 9 },
    });
  });

  it("blocks promotion with stable, source-labelled critical failures", () => {
    expect(evaluatePromotion({ ...input, timeline: { expectedSegments: 2, actualSegments: 1 }, captions: { required: true, hasCaptions: false, evidence: { coverage: 0.8, legible: false, occluded: false } }, usage: { spent: 12, reserved: 1, unit: "usd-micros" }, ux: { ...input.ux, targetComprehension: 0.75, resultComprehension: 0.8, captionDistraction: 0.2, professionalismTrust: 0.8, retentionProxy: 0.8 } })).toEqual({
      status: "blocked",
      criticalFailures: [
        { source: "quality", message: "storyboard covers 1 segments; expected 2" },
        { source: "quality", message: "output is missing required captions sidecar" },
        { source: "quality", message: "caption coverage 80% is incomplete" },
        { source: "quality", message: "captions are not legible" },
        { source: "usage", message: "usage ledger has 1 usd-micros reserved" },
        { source: "ux", message: "target comprehension 75% is below 80%" },
        { source: "ux", message: "UX aggregate 79% is below 80%" },
      ],
      quality: { status: "failed", failures: ["storyboard covers 1 segments; expected 2", "output is missing required captions sidecar", "caption coverage 80% is incomplete", "captions are not legible"] },
      ux: { status: "failed", score: 0.79, failures: ["target comprehension 75% is below 80%", "UX aggregate 79% is below 80%"] },
      uxEvidenceSource: "synthetic-baseline",
      usage: { spent: 12, reserved: 1, unit: "usd-micros", cacheHits: 0, cacheSavings: 0 },
    });
  });
});

