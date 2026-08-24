import { describe, expect, it } from "vitest";
import {
  PROFESSIONAL_RENDER_PROFILE,
  buildFramePreservingFilter,
  resolveRenderProfile,
} from "../../../src/adapters/compose/render-profile.js";

describe("render profiles", () => {
  it("selects explicit landscape, vertical, and square profiles while preserving landscape by default", () => {
    expect(resolveRenderProfile()).toBe(PROFESSIONAL_RENDER_PROFILE);
    expect(resolveRenderProfile("shorts")).toMatchObject({ viewport: { width: 1080, height: 1920 }, aspectRatio: "9:16" });
    expect(resolveRenderProfile("square")).toMatchObject({ viewport: { width: 1080, height: 1080 }, aspectRatio: "1:1" });
  });

  it("uses scale-and-pad rather than crop for non-landscape delivery, preserving every discovered target", () => {
    const filter = buildFramePreservingFilter(resolveRenderProfile("shorts"));

    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("pad=1080:1920");
    expect(filter).not.toContain("crop=");
  });
});
