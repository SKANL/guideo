import { describe, expect, it } from "vitest";
import { buildCutPrivateScenesArgv } from "../../../src/adapters/effects/cut-private-scenes-argv.js";

describe("buildCutPrivateScenesArgv — argv-array process boundary safety", () => {
  const ranges = [
    { startSec: 0, endSec: 1 },
    { startSec: 2.5, endSec: 4 },
  ];

  it("passes a clip path with shell metacharacters through as one literal argv item", () => {
    const malicious = "clip.mp4; rm -rf ~ | $(touch pwned) `touch pwned2` and spaces.mp4";

    const argv = buildCutPrivateScenesArgv(malicious, ranges, "cut.mp4");

    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    expect(argv).not.toContain("rm");
    expect(argv).not.toContain("-rf");
    expect(argv).not.toContain("touch");
  });

  it("passes an output path with shell metacharacters through as one literal argv item", () => {
    const maliciousOutput = "out `id`.mp4";

    const argv = buildCutPrivateScenesArgv("clip.mp4", ranges, maliciousOutput);

    expect(argv.at(-1)).toBe(maliciousOutput);
  });

  it("neutralizes a leading-dash clip path so ffmpeg's argv parser cannot read it as a flag", () => {
    const argv = buildCutPrivateScenesArgv("-x.mp4", ranges, "cut.mp4");

    expect(argv).not.toContain("-x.mp4");
    expect(argv).toContain("./-x.mp4");
  });

  it("neutralizes a leading-dash output path the same way", () => {
    const argv = buildCutPrivateScenesArgv("clip.mp4", ranges, "-oevil.mp4");

    expect(argv).not.toContain("-oevil.mp4");
    expect(argv.at(-1)).toBe("./-oevil.mp4");
  });

  it("builds one trim+setpts fragment per kept range, concatenated, video-only, mapped to a single output", () => {
    const argv = buildCutPrivateScenesArgv("clip.mp4", ranges, "cut.mp4");

    const filterIndex = argv.indexOf("-filter_complex");
    expect(filterIndex).toBeGreaterThanOrEqual(0);
    const filterComplex = argv[filterIndex + 1];
    expect(filterComplex).toBe(
      "[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS[c0];" +
        "[0:v]trim=start=2.500:end=4.000,setpts=PTS-STARTPTS[c1];" +
        "[c0][c1]concat=n=2:v=1:a=0[vout]",
    );
    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "cut.mp4",
    ]);
  });
});
