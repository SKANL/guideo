import { describe, expect, it } from "vitest";
import { EffectSchema, parseEffect } from "../../../src/domain/models/effect.js";

describe("EffectSchema", () => {
  it("parses a valid effect with a known type and params", () => {
    const effect = parseEffect({ type: "zoom-in", params: { x: 10, y: 20 } });
    expect(effect).toEqual({ type: "zoom-in", params: { x: 10, y: 20 } });
  });

  it("defaults params to {} when omitted", () => {
    const effect = parseEffect({ type: "crop" });
    expect(effect.params).toEqual({});
  });

  it("rejects an unknown effect type", () => {
    const result = EffectSchema.safeParse({ type: "spin-360", params: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("type"))).toBe(true);
    }
  });

  it("accepts every documented effect type", () => {
    for (const type of ["zoom-in", "zoom-out", "crop", "blur-region", "transition"]) {
      expect(() => parseEffect({ type, params: {} })).not.toThrow();
    }
  });
});
