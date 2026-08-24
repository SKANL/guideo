import { describe, expect, it } from "vitest";
import { aggregateRealUxEvidence, parseRealUxEvidence } from "../../../src/domain/quality/real-ux-evidence.js";

describe("real UX evidence", () => {
  const evidence = {
    schema: "guideo.real-ux-evidence",
    version: 1,
    kind: "real",
    source: { system: "post-render-survey", method: "session-rating", collectedAt: "2026-08-24T12:00:00.000Z" },
    consent: { obtained: true, policyVersion: "2026-08" },
    sessions: [
      { anonymousSessionId: "anon-a1b2c3d4", rating: { targetComprehension: 0.8, resultComprehension: 0.9, captionDistraction: 0.1, professionalismTrust: 0.8, retentionProxy: 0.7 }, observation: "Clear outcome." },
      { anonymousSessionId: "anon-e5f6g7h8", rating: { targetComprehension: 1, resultComprehension: 0.9, captionDistraction: 0.2, professionalismTrust: 1, retentionProxy: 0.9 } },
    ],
  } as const;

  it("validates consent and source metadata, then deterministically aggregates anonymized session ratings", () => {
    const report = aggregateRealUxEvidence(parseRealUxEvidence(evidence));
    expect(report).toEqual({
      schema: "guideo.real-ux-evidence-report",
      version: 1,
      source: "real",
      sessions: 2,
      metrics: { targetComprehension: 0.9, resultComprehension: 0.9, captionDistraction: 0.15, professionalismTrust: 0.9, retentionProxy: 0.8 },
    });
  });

  it("rejects missing consent, fabricated/example data, and non-anonymized identifiers", () => {
    expect(() => parseRealUxEvidence({ ...evidence, consent: { obtained: false, policyVersion: "2026-08" } })).toThrow("consent must be obtained");
    expect(() => parseRealUxEvidence({ ...evidence, example: true, sessions: [] })).toThrow("cannot be an example");
    expect(() => parseRealUxEvidence({ ...evidence, sessions: [{ ...evidence.sessions[0], anonymousSessionId: "person@example.com" }] })).toThrow("anonymousSessionId");
  });
});
