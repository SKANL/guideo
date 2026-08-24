import { describe, expect, it } from "vitest";
import { classifyDeadAir, planRhythmBeats } from "../../../src/domain/timeline/rhythm.js";

describe("timeline rhythm", () => {
  it("classifies only unintentional gaps as dead air while preserving functional waits", () => {
    expect(classifyDeadAir([{ startMs: 0, endMs: 900, kind: "loading", intentional: true }, { startMs: 1_000, endMs: 1_800, kind: "typing", intentional: false }])).toEqual([
      { startMs: 1_000, endMs: 1_800, kind: "typing", intentional: false },
    ]);
  });

  it("plans deterministic beats around supplied speech without inventing audio", () => {
    const words = [{ text: "Open", startMs: 0, endMs: 300 }, { text: "settings", startMs: 300, endMs: 800 }];
    expect(planRhythmBeats(words, 1_200)).toEqual([
      { kind: "speech", startMs: 0, endMs: 800 },
      { kind: "hold", startMs: 800, endMs: 1_200 },
    ]);
    expect(planRhythmBeats([], 1_200)).toEqual([{ kind: "silent", startMs: 0, endMs: 1_200 }]);
  });
});
