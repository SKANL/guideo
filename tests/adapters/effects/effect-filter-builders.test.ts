import { describe, expect, it } from "vitest";
import {
  type FilterGate,
  filterBuilderRegistry,
} from "../../../src/adapters/effects/effect-filter-builders.js";
import type { Effect } from "../../../src/domain/models/effect.js";

const gate: FilterGate = { startSec: 1.5, endSec: 4 };

describe("filterBuilderRegistry — pure effect -> ffmpeg filter_complex fragment builders", () => {
  it("zoom-in: crops a centered region on a split branch and overlays it full-frame, gated by enable=between(t,a,b)", () => {
    const effect: Effect = { type: "zoom-in", params: {} };

    const fragment = filterBuilderRegistry["zoom-in"]?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toBe(
      "[0:v]split=2[e1_base][e1_src];" +
        "[e1_src]crop=iw/1.3:ih/1.3:(iw-iw/1.3)/2:(ih-ih/1.3)/2,scale=iw*1.3:ih*1.3[e1_zoom];" +
        "[e1_base][e1_zoom]overlay=0:0:enable='between(t,1.5,4)'[v1]",
    );
  });

  it("zoom-in: honors an explicit params.level override", () => {
    const effect: Effect = { type: "zoom-in", params: { level: 2 } };

    const fragment = filterBuilderRegistry["zoom-in"]?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toContain("crop=iw/2:ih/2:(iw-iw/2)/2:(ih-ih/2)/2");
    expect(fragment).toContain("scale=iw*2:ih*2");
  });

  it("zoom-out: shares the same steady digital-zoom mechanism with its own default level", () => {
    const effect: Effect = { type: "zoom-out", params: {} };

    const fragment = filterBuilderRegistry["zoom-out"]?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toBe(
      "[0:v]split=2[e1_base][e1_src];" +
        "[e1_src]crop=iw/1.15:ih/1.15:(iw-iw/1.15)/2:(ih-ih/1.15)/2,scale=iw*1.15:ih*1.15[e1_zoom];" +
        "[e1_base][e1_zoom]overlay=0:0:enable='between(t,1.5,4)'[v1]",
    );
  });

  it("crop: spotlights the region with four gated black drawbox bars, never touching frame size", () => {
    const effect: Effect = { type: "crop", params: { x: 10, y: 20, w: 100, h: 50 } };

    const fragment = filterBuilderRegistry.crop?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toBe(
      "[0:v]" +
        "drawbox=x=0:y=0:w=iw:h=20:color=black:t=fill:enable='between(t,1.5,4)'," +
        "drawbox=x=0:y=70:w=iw:h=ih-70:color=black:t=fill:enable='between(t,1.5,4)'," +
        "drawbox=x=0:y=20:w=10:h=50:color=black:t=fill:enable='between(t,1.5,4)'," +
        "drawbox=x=110:y=20:w=iw-110:h=50:color=black:t=fill:enable='between(t,1.5,4)'" +
        "[v1]",
    );
  });

  it("crop: returns null (skip) for missing/malformed region params instead of crashing", () => {
    const effect: Effect = { type: "crop", params: { x: 10, y: 20 } };

    const fragment = filterBuilderRegistry.crop?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toBeNull();
  });

  it("crop: returns null for a non-positive width/height", () => {
    const effect: Effect = { type: "crop", params: { x: 0, y: 0, w: 0, h: 50 } };

    const fragment = filterBuilderRegistry.crop?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toBeNull();
  });

  it("blur-region: crop -> boxblur on a split branch, overlaid back in place, gated by enable=between(t,a,b)", () => {
    const effect: Effect = { type: "blur-region", params: { x: 5, y: 6, w: 200, h: 80 } };

    const fragment = filterBuilderRegistry["blur-region"]?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toBe(
      "[0:v]split=2[e1_base][e1_src];" +
        "[e1_src]crop=200:80:5:6,boxblur=10[e1_blur];" +
        "[e1_base][e1_blur]overlay=5:6:enable='between(t,1.5,4)'[v1]",
    );
  });

  it("blur-region: returns null (skip) for malformed region params", () => {
    const effect: Effect = { type: "blur-region", params: { x: "nope" } };

    const fragment = filterBuilderRegistry["blur-region"]?.(effect, gate, "[0:v]", "[v1]", "e1");

    expect(fragment).toBeNull();
  });
});
