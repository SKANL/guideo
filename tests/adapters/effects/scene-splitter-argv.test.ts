import { describe, expect, it } from "vitest";
import { buildSceneSplitArgv } from "../../../src/adapters/effects/scene-splitter-argv.js";

describe("buildSceneSplitArgv — argv-array process boundary safety", () => {
  const range = { startSec: 1.5, endSec: 3.25 };

  it("passes a clip path with shell metacharacters through as one literal argv item", () => {
    const malicious = "clip.mp4; rm -rf ~ | $(touch pwned) `touch pwned2` and spaces.mp4";

    const argv = buildSceneSplitArgv(malicious, range, "scene-0.mp4");

    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    expect(argv).not.toContain("rm");
    expect(argv).not.toContain("-rf");
    expect(argv).not.toContain("touch");
  });

  it("passes an output path with shell metacharacters through as one literal argv item", () => {
    const maliciousOutput = "out `id`.mp4";

    const argv = buildSceneSplitArgv("clip.mp4", range, maliciousOutput);

    expect(argv.at(-1)).toBe(maliciousOutput);
  });

  it("neutralizes a leading-dash clip path so ffmpeg's argv parser cannot read it as a flag", () => {
    const argv = buildSceneSplitArgv("-x.mp4", range, "scene-0.mp4");

    expect(argv).not.toContain("-x.mp4");
    expect(argv).toContain("./-x.mp4");
  });

  it("neutralizes a leading-dash output path the same way", () => {
    const argv = buildSceneSplitArgv("clip.mp4", range, "-oevil.mp4");

    expect(argv).not.toContain("-oevil.mp4");
    expect(argv.at(-1)).toBe("./-oevil.mp4");
  });

  it("builds a frame-accurate trim+setpts filter for the given range, mapped to a single output", () => {
    const argv = buildSceneSplitArgv("clip.mp4", range, "scene-0.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-vf",
      "trim=start=1.500:end=3.250,setpts=PTS-STARTPTS",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "scene-0.mp4",
    ]);
  });
});
