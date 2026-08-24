import { describe, expect, it } from "vitest";
import { resolveFfprobePath } from "../../../src/adapters/media/ffprobe-path.js";

describe("resolveFfprobePath", () => {
  it("prefers the explicit GUIDEO_FFPROBE_PATH override", () => {
    expect(resolveFfprobePath({ GUIDEO_FFPROBE_PATH: "C:/tools/ffprobe.exe", PATH: "C:/bin" }, "bundled-ffprobe"))
      .toBe("C:/tools/ffprobe.exe");
  });

  it("uses the reproducible bundled binary before relying on PATH", () => {
    expect(resolveFfprobePath({ PATH: "C:/bin" }, "bundled-ffprobe"))
      .toBe("bundled-ffprobe");
  });

  it("falls back to PATH's ffprobe command when no override or bundled binary exists", () => {
    expect(resolveFfprobePath({ PATH: "C:/bin" }, null)).toBe("ffprobe");
  });

  it("fails explicitly instead of silently skipping validation when ffprobe cannot be resolved", () => {
    expect(() => resolveFfprobePath({}, null)).toThrow(/GUIDEO_FFPROBE_PATH.*PATH/i);
  });
});
