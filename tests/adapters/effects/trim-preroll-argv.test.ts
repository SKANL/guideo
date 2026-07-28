import { describe, expect, it } from "vitest";
import { buildTrimPrerollArgv } from "../../../src/adapters/effects/trim-preroll-argv.js";

describe("buildTrimPrerollArgv — argv-array process boundary safety", () => {
  it("passes a clip path with shell metacharacters through as one literal argv item", () => {
    const malicious = "clip.mp4; rm -rf ~ | $(touch pwned) `touch pwned2` and spaces.mp4";

    const argv = buildTrimPrerollArgv(malicious, 0.6, "trimmed.mp4");

    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    expect(argv).not.toContain("rm");
    expect(argv).not.toContain("-rf");
    expect(argv).not.toContain("touch");
  });

  it("passes an output path with shell metacharacters through as one literal argv item", () => {
    const maliciousOutput = "out `id`.mp4";

    const argv = buildTrimPrerollArgv("clip.mp4", 0.6, maliciousOutput);

    expect(argv.at(-1)).toBe(maliciousOutput);
  });

  it("neutralizes a leading-dash clip path so ffmpeg's argv parser cannot read it as a flag", () => {
    const argv = buildTrimPrerollArgv("-x.mp4", 0.6, "trimmed.mp4");

    expect(argv).not.toContain("-x.mp4");
    expect(argv).toContain("./-x.mp4");
  });

  it("neutralizes a leading-dash output path the same way", () => {
    const argv = buildTrimPrerollArgv("clip.mp4", 0.6, "-oevil.mp4");

    expect(argv).not.toContain("-oevil.mp4");
    expect(argv.at(-1)).toBe("./-oevil.mp4");
  });

  it("builds the exact argv, seeking AFTER -i (accurate/output seeking, not fast/input seeking)", () => {
    const argv = buildTrimPrerollArgv("clip.mp4", 0.6, "trimmed.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-ss",
      "0.600",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "trimmed.mp4",
    ]);
    // -ss must appear AFTER -i: output/accurate seeking (frame-accurate), not input/fast seeking
    // (keyframe-only) — this whole feature exists to fix a sub-frame alignment bug, so an
    // imprecise trim would silently reintroduce it.
    expect(argv.indexOf("-i")).toBeLessThan(argv.indexOf("-ss"));
  });
});
