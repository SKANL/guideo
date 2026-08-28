import { describe, expect, it } from "vitest";
import { buildCanonicalTimeline, evaluateTimelineQuality } from "../../../src/domain/timeline/canonical-timeline.js";

describe("canonical timeline", () => {
  it("shares canonical timestamps and hashes across speech, captions, cues, and QA", () => {
    const timeline = buildCanonicalTimeline({ script: { segments: [{ id: "s1", text: "Click Save now", timing: { startMs: 0, durationMs: 1_000 } }] }, speech: [{ segmentId: "s1", words: [{ text: "Click", startMs: 0, endMs: 300 }, { text: "Save", startMs: 300, endMs: 600 }, { text: "now", startMs: 600, endMs: 1_000 }], approximate: false }], actions: [{ segmentId: "s1", kind: "click", startMs: 300, endMs: 600, target: { role: "button", accessibleName: "Save" }, evidenceRefs: ["before", "after"] }], cues: [{ segmentId: "s1", kind: "callout", entryMs: 300, apexMs: 450, exitMs: 600, rationale: "Focus the action", target: { role: "button", accessibleName: "Save" }, evidenceRefs: ["before", "after"] }] });
    expect(timeline.captions).toEqual([{ text: "Click Save now", startMs: 0, endMs: 1_000, source: "provider" }]);
    expect(timeline.hash).toBe(timeline.qaHash);
    expect(evaluateTimelineQuality(timeline)).toEqual({ status: "passed", failures: [] });
  });
  it("uses deterministic approximate fallback and blocks dead-air and overlapping cues", () => {
    const timeline = buildCanonicalTimeline({ script: { segments: [{ id: "s1", text: "Click Save", timing: { startMs: 0, durationMs: 2_000 } }] }, actions: [{ segmentId: "s1", kind: "click", startMs: 0, endMs: 100, target: { role: "button", accessibleName: "Save" }, evidenceRefs: ["after"] }], cues: [{ segmentId: "s1", kind: "zoom", entryMs: 0, apexMs: 100, exitMs: 800, rationale: "Focus", target: { role: "button", accessibleName: "Save" }, evidenceRefs: ["after"] }, { segmentId: "s1", kind: "callout", entryMs: 700, apexMs: 800, exitMs: 1_000, rationale: "Focus", target: { role: "button", accessibleName: "Save" }, evidenceRefs: ["after"] }], pauses: [{ startMs: 1_000, endMs: 2_000, kind: "typing", intentional: false }] });
    expect(timeline.speech[0]?.approximate).toBe(true);
    expect(timeline.speech[0]?.words.map((word) => word.startMs)).toEqual([0, 1_000]);
    expect(evaluateTimelineQuality(timeline).status).toBe("failed");
    expect(evaluateTimelineQuality(timeline).failures.join(" ")).toMatch(/dead-air|overlap/);
  });
  it("preserves supplied speech provenance in captions while requiring every timed word to be covered", () => {
    const timeline = buildCanonicalTimeline({ script: { segments: [{ id: "s1", text: "Go now", timing: { startMs: 0, durationMs: 1_000 } }] }, speech: [{ segmentId: "s1", words: [{ text: "Go", startMs: 20, endMs: 300 }, { text: "now", startMs: 400, endMs: 900 }], approximate: false, provenance: { audioSha256: "a".repeat(64), provider: "elevenlabs", model: "model-1", voiceId: "voice-1", seed: 7, measuredCost: { unit: "usd-micros", amount: 18, cache: "miss" } } }] });
    expect(timeline.captions).toEqual([{ text: "Go now", startMs: 20, endMs: 900, source: "provider", provenance: { audioSha256: "a".repeat(64), provider: "elevenlabs", model: "model-1", voiceId: "voice-1", seed: 7, measuredCost: { unit: "usd-micros", amount: 18, cache: "miss" } } }]);
    expect(evaluateTimelineQuality(timeline)).toEqual({ status: "passed", failures: [] });
  });
  it("clamps provider word timing to its segment without extending caption evidence", () => {
    const timeline = buildCanonicalTimeline({ script: { segments: [{ id: "s1", text: "Real provider timing", timing: { startMs: 0, durationMs: 4_500 } }] }, speech: [{ segmentId: "s1", words: [{ text: "Real", startMs: 0, endMs: 8_916 }], approximate: false }] });
    expect(timeline.speech[0]?.words).toEqual([{ text: "Real", startMs: 0, endMs: 4_500 }]);
    expect(timeline.captions).toEqual([{ text: "Real provider timing", startMs: 0, endMs: 4_500, source: "provider" }]);
  });
  it("keeps provider captions from overlapping their predecessor", () => {
    const timeline = buildCanonicalTimeline({ script: { segments: [{ id: "s1", text: "First", timing: { startMs: 0, durationMs: 4_500 } }, { id: "s2", text: "Second", timing: { startMs: 4_000, durationMs: 2_000 } }] }, speech: [{ segmentId: "s1", words: [{ text: "First", startMs: 0, endMs: 4_500 }], approximate: false }, { segmentId: "s2", words: [{ text: "Second", startMs: 4_000, endMs: 6_000 }], approximate: false }] });
    expect(timeline.captions).toEqual([{ text: "First", startMs: 0, endMs: 4_500, source: "provider" }, { text: "Second", startMs: 4_500, endMs: 6_000, source: "provider" }]);
  });
});
