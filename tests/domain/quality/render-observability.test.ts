import { describe, expect, it } from "vitest";
import { compareVisualBaseline, measureRenderObservability } from "../../../src/domain/quality/render-observability.js";

describe("render observability", () => {
  it("measures dead air, caption overlap, and un-targeted zooms deterministically", () => {
    expect(measureRenderObservability({
      segments: [
        { id: "one", timing: { startMs: 0, durationMs: 1_000 } },
        { id: "two", timing: { startMs: 1_400, durationMs: 600 } },
      ],
      storyboard: {
        steps: [
          { narrationSegmentId: "one", selector: "#save", effects: [{ type: "zoom-in", params: {} }] },
          { narrationSegmentId: "two", effects: [{ type: "zoom-out", params: {} }] },
        ],
      },
      captions: [
        { startMs: 0, durationMs: 800 },
        { startMs: 700, durationMs: 500 },
      ],
    })).toEqual({ deadAirMs: 400, captionOverlapMs: 100, zoomsWithoutTarget: 1 });
  });

  it("rejects baseline comparisons with missing or mismatched deterministic frame hashes", () => {
    expect(compareVisualBaseline(
      [{ atMs: 0, bytes: 10, sha256: "current" }],
      [{ atMs: 0, bytes: 10, sha256: "baseline" }],
    )).toEqual({ status: "failed", failures: ["frame checkpoint 0ms differs from visual baseline"] });
  });
});
