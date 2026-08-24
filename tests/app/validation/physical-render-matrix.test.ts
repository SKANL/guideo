import { describe, expect, it } from "vitest";
import {
  PHYSICAL_RENDER_VALIDATION_MATRIX,
  validatePhysicalRenderMatrix,
} from "../../../src/app/validation/physical-render-matrix.js";

describe("physical render validation matrix", () => {
  it("defines every profile/narration combination with its expected dimensions and audio stream", () => {
    expect(PHYSICAL_RENDER_VALIDATION_MATRIX).toHaveLength(9);
    expect(PHYSICAL_RENDER_VALIDATION_MATRIX.map((scenario) => scenario.id)).toEqual([
      "youtube-silent",
      "youtube-subtitles",
      "youtube-both",
      "shorts-silent",
      "shorts-subtitles",
      "shorts-both",
      "square-silent",
      "square-subtitles",
      "square-both",
    ]);
    expect(validatePhysicalRenderMatrix()).toEqual([]);
    expect(PHYSICAL_RENDER_VALIDATION_MATRIX).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "youtube-both", width: 1920, height: 1080, hasAudio: true }),
        expect.objectContaining({
          id: "shorts-subtitles",
          width: 1080,
          height: 1920,
          hasAudio: false,
        }),
        expect.objectContaining({
          id: "square-silent",
          width: 1080,
          height: 1080,
          hasAudio: false,
        }),
      ]),
    );
  });
});
