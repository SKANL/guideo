import { describe, expect, it } from "vitest";
import { parseNarrationMode } from "../../../src/domain/models/narration-mode.js";

describe("parseNarrationMode", () => {
  it.each(["voice", "subtitles", "both"] as const)("accepts %s", (value) => {
    expect(parseNarrationMode(value)).toBe(value);
  });

  it("throws a clear error for an invalid value", () => {
    expect(() => parseNarrationMode("captions")).toThrow(/Invalid --narration value "captions"/);
  });
});
