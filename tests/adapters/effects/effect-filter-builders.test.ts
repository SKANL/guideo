import { describe, expect, it } from "vitest";
import {
  type FilterGate,
  filterBuilderRegistry,
} from "../../../src/adapters/effects/effect-filter-builders.js";
import type { Effect } from "../../../src/domain/models/effect.js";
import type { EffectRegion } from "../../../src/domain/models/media.js";

const gate: FilterGate = { startSec: 1.5, endSec: 4 };
const region: EffectRegion = { x: 100, y: 60, w: 40, h: 30 };

describe("filterBuilderRegistry — pure effect -> ffmpeg filter_complex fragment builders", () => {
  describe("zoom-in / zoom-out — animated Ken Burns, centered on the resolved region", () => {
    it("zoom-in: animates level from 1 up to the default over the gate duration, on a split branch overlaid gated by enable=between(t,a,b)", () => {
      const effect: Effect = { type: "zoom-in", params: {} };

      const fragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toContain("[0:v]split=2[e1_base][e1_src]");
      expect(fragment).toContain("eval=frame");
      // animates: level starts at 1 and ramps toward the default (1.3) as progress -> 1.
      expect(fragment).toContain("(1+(1.3-1)*");
      expect(fragment).toContain("[e1_base][e1_zoom]overlay=0:0:enable='between(t,1.5,4)'[v1]");
    });

    it("zoom-in: with no region, centers on the frame (iw/2, ih/2)", () => {
      const effect: Effect = { type: "zoom-in", params: {} };

      const fragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toContain("x='iw/2-");
      expect(fragment).toContain("y='ih/2-");
    });

    it("zoom-in: with a resolved region, centers on the region's center instead of the frame", () => {
      const effect: Effect = { type: "zoom-in", params: {} };

      const fragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        region,
        "[0:v]",
        "[v1]",
        "e1",
      );

      // center = x + w/2 = 120, y + h/2 = 75
      expect(fragment).toContain("x='120-");
      expect(fragment).toContain("y='75-");
      expect(fragment).not.toContain("iw/2");
      expect(fragment).not.toContain("ih/2");
    });

    it("zoom-in: honors an explicit params.level override", () => {
      const effect: Effect = { type: "zoom-in", params: { level: 2 } };

      const fragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toContain("(1+(2-1)*");
    });

    it("zoom-out: reverses the animation direction (level starts high and ramps toward 1) — distinct from zoom-in", () => {
      const effect: Effect = { type: "zoom-out", params: {} };

      const fragment = filterBuilderRegistry["zoom-out"]?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );
      const zoomInFragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toContain("(1.3-(1.3-1)*");
      expect(fragment).not.toBe(zoomInFragment);
    });
  });

  describe("crop — spotlights the resolved region, never touching frame size", () => {
    it("spotlights the region with four gated black drawbox bars", () => {
      const effect: Effect = { type: "crop", params: {} };

      const fragment = filterBuilderRegistry.crop?.(
        effect,
        gate,
        { x: 10, y: 20, w: 100, h: 50 },
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toBe(
        "[0:v]" +
          "drawbox=x=0:y=0:w=iw:h=20:color=black:t=fill:enable='between(t,1.5,4)'," +
          "drawbox=x=0:y=70:w=iw:h=ih-70:color=black:t=fill:enable='between(t,1.5,4)'," +
          "drawbox=x=0:y=20:w=10:h=50:color=black:t=fill:enable='between(t,1.5,4)'," +
          "drawbox=x=110:y=20:w=iw-110:h=50:color=black:t=fill:enable='between(t,1.5,4)'" +
          "[v1]",
      );
    });

    it("returns null (skip) when no region was resolved instead of crashing", () => {
      const effect: Effect = { type: "crop", params: {} };

      const fragment = filterBuilderRegistry.crop?.(effect, gate, null, "[0:v]", "[v1]", "e1");

      expect(fragment).toBeNull();
    });
  });

  describe("blur-region — crop -> boxblur on a split branch, overlaid back in place", () => {
    it("blurs the resolved region, gated by enable=between(t,a,b)", () => {
      const effect: Effect = { type: "blur-region", params: {} };

      const fragment = filterBuilderRegistry["blur-region"]?.(
        effect,
        gate,
        { x: 5, y: 6, w: 200, h: 80 },
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toBe(
        "[0:v]split=2[e1_base][e1_src];" +
          "[e1_src]crop=200:80:5:6,boxblur=10[e1_blur];" +
          "[e1_base][e1_blur]overlay=5:6:enable='between(t,1.5,4)'[v1]",
      );
    });

    it("returns null (skip) when no region was resolved", () => {
      const effect: Effect = { type: "blur-region", params: {} };

      const fragment = filterBuilderRegistry["blur-region"]?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toBeNull();
    });
  });
});
