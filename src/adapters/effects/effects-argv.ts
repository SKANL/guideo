// Pure ffmpeg argv builder — no I/O, no process spawning. Mirrors compose-argv.ts's discipline:
// every path is emitted as exactly one argv array element (never shell-interpolated by the
// caller), so shell metacharacters in a filename are always inert here.

function sanitizePositionalPath(path: string): string {
  // Same rationale as compose-argv.ts's sanitizePositionalPath: a leading "-" is the only case
  // ffmpeg's own argv parser could misread as a flag rather than a filename.
  return path.startsWith("-") ? `./${path}` : path;
}

export function buildEffectsArgv(
  clipPath: string,
  filterComplex: string,
  outputLabel: string,
  outputPath: string,
): string[] {
  return [
    "-y",
    "-i",
    sanitizePositionalPath(clipPath),
    "-filter_complex",
    filterComplex,
    "-map",
    outputLabel,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    sanitizePositionalPath(outputPath),
  ];
}
