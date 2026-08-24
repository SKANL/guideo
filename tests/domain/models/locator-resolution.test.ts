import { describe, expect, it } from "vitest";
import {
  LocatorResolutionError,
  orderedLocatorCandidates,
  resolveExactlyOne,
} from "../../../src/domain/models/locator-resolution.js";

describe("semantic locator resolution", () => {
  it("orders and deduplicates discovery candidates while retaining the legacy selector", () => {
    expect(orderedLocatorCandidates(["#z", "#a", "#a"], "#legacy")).toEqual([
      "#a", "#legacy", "#z",
    ]);
  });

  it("fails closed with structured diagnostics when a candidate is ambiguous", () => {
    expect(() => resolveExactlyOne([
      { selector: "#a", matches: [1, 2] },
      { selector: "#legacy", matches: [3] },
    ])).toThrowError(LocatorResolutionError);
    try {
      resolveExactlyOne([{ selector: "#a", matches: [1, 2] }]);
    } catch (error) {
      expect((error as LocatorResolutionError).diagnostic).toEqual({
        kind: "ambiguous", candidates: ["#a"], matches: { "#a": 2 },
      });
    }
  });

  it("fails closed when distinct candidates each uniquely match different DOM targets", () => {
    expect(() => resolveExactlyOne([{ selector: "#a", matches: [1] }, { selector: "#b", matches: [2] }])).toThrow(/ambiguous/);
  });

  it("fails closed when none of the reviewed candidates match", () => {
    expect(() => resolveExactlyOne([{ selector: "#a", matches: [] }])).toThrow(/zero-match/);
  });
});
