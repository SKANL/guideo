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
        region,
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

    it("zoom-in: with no region, is a no-op", () => {
      const effect: Effect = { type: "zoom-in", params: {} };

      const fragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toBeNull();
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
      expect(fragment).toContain("x='max(0,min(120-");
      expect(fragment).toContain("y='max(0,min(75-");
    });

    it("zoom-in: bounds an explicit params.level override to the professional maximum", () => {
      const effect: Effect = { type: "zoom-in", params: { level: 2 } };

      const fragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        region,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toContain("(1+(1.4-1)*");
    });

    it("zoom-out: reverses the animation direction (level starts high and ramps toward 1) — distinct from zoom-in", () => {
      const effect: Effect = { type: "zoom-out", params: {} };

      const fragment = filterBuilderRegistry["zoom-out"]?.(
        effect,
        gate,
        region,
        "[0:v]",
        "[v1]",
        "e1",
      );
      const zoomInFragment = filterBuilderRegistry["zoom-in"]?.(
        effect,
        gate,
        region,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toContain("(1.3-(1.3-1)*");
      expect(fragment).not.toBe(zoomInFragment);
    });
  });

  describe("crop — spotlights the resolved region, never touching frame size", () => {
    it("draws a gated translucent outline without blacking out the surrounding UI", () => {
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
        "[0:v]drawbox=x=10:y=20:w=100:h=50:color=white@0.9:t=4:enable='between(t,1.5,4)'[v1]",
      );
      expect(fragment).not.toContain("color=black");
      expect(fragment).not.toContain("t=fill");
    });

    it("returns null (skip) when no region was resolved instead of crashing", () => {
      const effect: Effect = { type: "crop", params: {} };

      const fragment = filterBuilderRegistry.crop?.(effect, gate, null, "[0:v]", "[v1]", "e1");

      expect(fragment).toBeNull();
    });
  });

  describe("transition — boundary fade (effects-overhaul Phase B/C), argv-safe (plain numeric filter args, no interpolated paths)", () => {
    it("edge=out: fades to black ending at the gate's endSec, over durationSec", () => {
      const effect: Effect = { type: "transition", params: { edge: "out", durationSec: 0.5 } };

      const fragment = filterBuilderRegistry.transition?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      // gate.endSec=4, durationSec=0.5 -> fade-out starts at st=3.5.
      expect(fragment).toBe("[0:v]fade=t=out:st=3.5:d=0.5:color=black[v1]");
    });

    it("edge=in: fades from black starting at the gate's startSec, over durationSec", () => {
      const effect: Effect = { type: "transition", params: { edge: "in", durationSec: 0.5 } };

      const fragment = filterBuilderRegistry.transition?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      // gate.startSec=1.5, durationSec=0.5 -> fade-in starts at st=1.5.
      expect(fragment).toBe("[0:v]fade=t=in:st=1.5:d=0.5:color=black[v1]");
    });

    it("defaults durationSec when omitted", () => {
      const effect: Effect = { type: "transition", params: { edge: "in" } };

      const fragment = filterBuilderRegistry.transition?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toContain("fade=t=in:st=1.5:d=");
    });

    it("returns null (skip) for a missing/invalid edge instead of crashing", () => {
      const effect: Effect = { type: "transition", params: {} };

      const fragment = filterBuilderRegistry.transition?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(fragment).toBeNull();
    });

    it("never touches region — same fragment regardless of a resolved region", () => {
      const effect: Effect = { type: "transition", params: { edge: "out", durationSec: 0.2 } };

      const withRegion = filterBuilderRegistry.transition?.(
        effect,
        gate,
        region,
        "[0:v]",
        "[v1]",
        "e1",
      );
      const withoutRegion = filterBuilderRegistry.transition?.(
        effect,
        gate,
        null,
        "[0:v]",
        "[v1]",
        "e1",
      );

      expect(withRegion).toBe(withoutRegion);
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
