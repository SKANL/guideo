// Pure ffmpeg argv builder — no I/O, no process spawning. Mirrors effects-argv.ts's/
// compose-argv.ts's discipline: every path is emitted as exactly one argv array element (never
// shell-interpolated by the caller), so shell metacharacters in a filename are always inert here.

function sanitizePositionalPath(path: string): string {
  // Same rationale as compose-argv.ts's sanitizePositionalPath: a leading "-" is the only case
  // ffmpeg's own argv parser could misread as a flag rather than a filename.
  return path.startsWith("-") ? `./${path}` : path;
}

// -ss placed AFTER -i is output/accurate seeking: ffmpeg decodes from the start and cuts exactly
// at the target time, frame-accurate. Placing -ss BEFORE -i would be input/fast seeking (the
// demuxer jumps to the nearest keyframe, which can be well off-target) — that imprecision would
// silently reintroduce the very alignment bug this trim step exists to fix, so re-encoding with
// accurate seeking is deliberate, not an oversight (a `-c copy` fast-path was considered and
// rejected for exactly this reason).
export function buildTrimPrerollArgv(
  clipPath: string,
  preRollSeconds: number,
  outputPath: string,
): string[] {
  return [
    "-y",
    "-i",
    sanitizePositionalPath(clipPath),
    "-ss",
    preRollSeconds.toFixed(3),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    sanitizePositionalPath(outputPath),
  ];
}
