import { describe, expect, it } from "vitest";
import { approvalManifest } from "../../src/domain/artifacts/manifest.js";
import { parseStoryboard } from "../../src/domain/models/storyboard.js";
import { reviewWithManifest } from "../../src/domain/review-gate.js";

const storyboard = parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });

describe("review-gate provenance", () => {
  it("refuses approval if the storyboard hash differs from the immutable manifest", () => {
    const manifest = approvalManifest({ flowGraph: "flow", script: "script", storyboard: "expected", policy: "policy" });
    expect(() => reviewWithManifest(storyboard, manifest, { flowGraph: "flow", script: "script", storyboard: "actual", policy: "policy" })).toThrow("hash mismatch");
  });
  it("refuses a manifest whose hash no longer matches its contents", () => {
    const manifest = { ...approvalManifest({ flowGraph: "flow", script: "script", storyboard: "actual", policy: "policy" }), sha256: "tampered" };
    expect(() => reviewWithManifest(storyboard, manifest, { flowGraph: "flow", script: "script", storyboard: "actual", policy: "policy" })).toThrow("hash mismatch");
  });
  it("persists the approval manifest provenance on the approved storyboard", () => {
    const manifest = approvalManifest({ flowGraph: "flow", script: "script", storyboard: "actual", policy: "policy" });
    const approved = reviewWithManifest(storyboard, manifest, { flowGraph: "flow", script: "script", storyboard: "actual", policy: "policy" });
    expect(approved?.approvalProvenance).toEqual({ schema: "approval", version: 2, manifestSha256: manifest.sha256 });
  });
});
