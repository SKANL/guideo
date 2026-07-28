import { describe, expect, it } from "vitest";
import { buildSceneAssembleArgv } from "../../../src/adapters/effects/scene-assembler-argv.js";

describe("buildSceneAssembleArgv — argv-array process boundary safety", () => {
  const clips = [
    { path: "scene-0.mp4", durationSec: 2 },
    { path: "scene-1.mp4", durationSec: 3 },
    { path: "scene-2.mp4", durationSec: 1.5 },
  ];

  it("passes clip paths with shell metacharacters through as one literal argv item each", () => {
    const malicious = "s0; rm -rf ~ | $(touch pwned) `touch pwned2` and spaces.mp4";

    const argv = buildSceneAssembleArgv(
      [{ path: malicious, durationSec: 2 }, ...clips.slice(1)],
      0.25,
      "assembled.mp4",
    );

    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    expect(argv).not.toContain("rm");
    expect(argv).not.toContain("-rf");
    expect(argv).not.toContain("touch");
  });

  it("passes an output path with shell metacharacters through as one literal argv item", () => {
    const maliciousOutput = "out `id`.mp4";

    const argv = buildSceneAssembleArgv(clips, 0.25, maliciousOutput);

    expect(argv.at(-1)).toBe(maliciousOutput);
  });

  it("neutralizes a leading-dash clip path so ffmpeg's argv parser cannot read it as a flag", () => {
    const argv = buildSceneAssembleArgv(
      [{ path: "-x.mp4", durationSec: 2 }, ...clips.slice(1)],
      0.25,
      "assembled.mp4",
    );

    expect(argv).not.toContain("-x.mp4");
    expect(argv).toContain("./-x.mp4");
  });

  it("neutralizes a leading-dash output path the same way", () => {
    const argv = buildSceneAssembleArgv(clips, 0.25, "-oevil.mp4");

    expect(argv).not.toContain("-oevil.mp4");
    expect(argv.at(-1)).toBe("./-oevil.mp4");
  });

  it("adds each clip as its own -i input, in order", () => {
    const argv = buildSceneAssembleArgv(clips, 0.25, "assembled.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "scene-0.mp4",
      "-i",
      "scene-1.mp4",
      "-i",
      "scene-2.mp4",
      "-filter_complex",
      expect.any(String),
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "assembled.mp4",
    ]);
  });

  it("first clip: no fade-in, fade-out only; last clip: fade-in only, no fade-out; middle clip: both", () => {
    const argv = buildSceneAssembleArgv(clips, 0.25, "assembled.mp4");
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    expect(filterComplex).toBe(
      "[0:v]fade=t=out:st=1.750:d=0.25[c0];" +
        "[1:v]fade=t=in:st=0:d=0.25,fade=t=out:st=2.750:d=0.25[c1];" +
        "[2:v]fade=t=in:st=0:d=0.25[c2];" +
        "[c0][c1][c2]concat=n=3:v=1:a=0[vout]",
    );
  });

  it("a single clip gets no fade at all (safe passthrough shape)", () => {
    const argv = buildSceneAssembleArgv(
      [{ path: "scene-0.mp4", durationSec: 2 }],
      0.25,
      "assembled.mp4",
    );
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    expect(filterComplex).toBe("[0:v]null[c0];[c0]concat=n=1:v=1:a=0[vout]");
  });
});

describe("buildSceneAssembleArgv — style='xfade' (real crossfade, overlapping clips)", () => {
  const clips = [
    { path: "scene-0.mp4", durationSec: 2 },
    { path: "scene-1.mp4", durationSec: 3 },
    { path: "scene-2.mp4", durationSec: 1.5 },
  ];

  it("chains xfade for N clips, each offset by the running (overlap-shrunk) accumulated duration", () => {
    const argv = buildSceneAssembleArgv(clips, 0.25, "assembled.mp4", "xfade");
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    // offset_1 = d0 - td = 2 - 0.25 = 1.75; offset_2 = d0+d1 - 2*td = 5 - 0.5 = 4.5
    expect(filterComplex).toBe(
      "[0:v][1:v]xfade=transition=fade:duration=0.25:offset=1.750[x0];" +
        "[x0][2:v]xfade=transition=fade:duration=0.25:offset=4.500[vout]",
    );
  });

  it("two clips xfade directly to [vout] with no intermediate label", () => {
    const argv = buildSceneAssembleArgv(clips.slice(0, 2), 0.25, "assembled.mp4", "xfade");
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    expect(filterComplex).toBe("[0:v][1:v]xfade=transition=fade:duration=0.25:offset=1.750[vout]");
  });

  it("uses the given transitionDurationSec for both duration and offsets", () => {
    const argv = buildSceneAssembleArgv(clips.slice(0, 2), 0.4, "assembled.mp4", "xfade");
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    expect(filterComplex).toContain("duration=0.4");
    // offset_1 = 2 - 0.4 = 1.6
    expect(filterComplex).toContain("offset=1.600");
  });

  it("still emits the same -i inputs / map / codec argv shape as dip style", () => {
    const argv = buildSceneAssembleArgv(clips, 0.25, "assembled.mp4", "xfade");

    expect(argv).toEqual([
      "-y",
      "-i",
      "scene-0.mp4",
      "-i",
      "scene-1.mp4",
      "-i",
      "scene-2.mp4",
      "-filter_complex",
      expect.any(String),
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "assembled.mp4",
    ]);
  });

  it("passes clip paths with shell metacharacters through as one literal argv item (xfade style too)", () => {
    const malicious = "s0; rm -rf ~ | $(touch pwned) `touch pwned2` and spaces.mp4";

    const argv = buildSceneAssembleArgv(
      [{ path: malicious, durationSec: 2 }, ...clips.slice(1)],
      0.25,
      "assembled.mp4",
      "xfade",
    );

    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    expect(argv).not.toContain("rm");
  });

  it("neutralizes a leading-dash clip path the same way in xfade style", () => {
    const argv = buildSceneAssembleArgv(
      [{ path: "-x.mp4", durationSec: 2 }, ...clips.slice(1)],
      0.25,
      "assembled.mp4",
      "xfade",
    );

    expect(argv).not.toContain("-x.mp4");
    expect(argv).toContain("./-x.mp4");
  });

  it("clamps a would-be-negative offset to 0 when clips are shorter than the transition duration", () => {
    const tinyClips = [
      { path: "scene-0.mp4", durationSec: 0.1 },
      { path: "scene-1.mp4", durationSec: 0.1 },
    ];
    const argv = buildSceneAssembleArgv(tinyClips, 0.25, "assembled.mp4", "xfade");
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    expect(filterComplex).toContain("offset=0.000");
  });
});
