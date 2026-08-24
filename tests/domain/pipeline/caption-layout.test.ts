import { describe, expect, it } from "vitest";
import { captionSafeRegions, projectOccupiedRegions, selectCaptionPlacement } from "../../../src/domain/pipeline/caption-layout.js";

describe("caption layout", () => {
  it.each([
    ["youtube", { width: 1920, height: 1080 }, { x: 144, y: 765, w: 1632, h: 225 }],
    ["shorts", { width: 1080, height: 1920 }, { x: 81, y: 1360, w: 918, h: 400 }],
    ["square", { width: 1080, height: 1080 }, { x: 81, y: 765, w: 918, h: 225 }],
  ] as const)("derives a pixel-bounded lower-third region for %s", (_profile, viewport, expected) => {
    expect(captionSafeRegions(viewport)[0]).toMatchObject({ placement: "lower-third", ...expected });
  });

  it("projects discovered 1280x720 rectangles through fit-and-pad before choosing a safe profile region", () => {
    const viewport = { width: 1080, height: 1920 };
    const occupied = projectOccupiedRegions([{ x: 0, y: 430, w: 1280, h: 290 }], viewport);

    expect(occupied).toEqual([{ x: 0, y: 1019, w: 1080, h: 245 }]);
    expect(selectCaptionPlacement(occupied, viewport)).toBe("lower-third");
  });
});
