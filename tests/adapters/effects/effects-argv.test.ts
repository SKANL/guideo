import { describe, expect, it } from "vitest";
import { buildEffectsArgv } from "../../../src/adapters/effects/effects-argv.js";

describe("buildEffectsArgv — argv-array process boundary safety", () => {
  it("passes a clip path with shell metacharacters through as one literal argv item", () => {
    const malicious = "clip.mp4; rm -rf ~ | $(touch pwned) `touch pwned2` and spaces.mp4";

    const argv = buildEffectsArgv(malicious, "[0:v]drawbox=1[v1]", "[v1]", "edited.mp4");

    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    expect(argv).not.toContain("rm");
    expect(argv).not.toContain("-rf");
    expect(argv).not.toContain("touch");
  });

  it("passes an output path with shell metacharacters through as one literal argv item", () => {
    const maliciousOutput = "out `id`.mp4";

    const argv = buildEffectsArgv("clip.mp4", "[0:v]drawbox=1[v1]", "[v1]", maliciousOutput);

    expect(argv.at(-1)).toBe(maliciousOutput);
  });

  it("neutralizes a leading-dash clip path so ffmpeg's argv parser cannot read it as a flag", () => {
    const argv = buildEffectsArgv("-x.mp4", "[0:v]drawbox=1[v1]", "[v1]", "edited.mp4");

    expect(argv).not.toContain("-x.mp4");
    expect(argv).toContain("./-x.mp4");
  });

  it("neutralizes a leading-dash output path the same way", () => {
    const argv = buildEffectsArgv("clip.mp4", "[0:v]drawbox=1[v1]", "[v1]", "-oevil.mp4");

    expect(argv).not.toContain("-oevil.mp4");
    expect(argv.at(-1)).toBe("./-oevil.mp4");
  });

  it("builds the exact argv for a filter_complex edit run", () => {
    const argv = buildEffectsArgv("clip.mp4", "[0:v]drawbox=1[v1]", "[v1]", "edited.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-filter_complex",
      "[0:v]drawbox=1[v1]",
      "-map",
      "[v1]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "edited.mp4",
    ]);
  });
});
