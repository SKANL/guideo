// Pure ffmpeg argv builder — no I/O, no process spawning. Mirrors cut-private-scenes-argv.ts's/
// trim-preroll-argv.ts's discipline: every path is emitted as exactly one argv array element
// (never shell-interpolated by the caller), so shell metacharacters in a filename are always inert
// here.

function sanitizePositionalPath(path: string): string {
  // Same rationale as cut-private-scenes-argv.ts's sanitizePositionalPath: a leading "-" is the
  // only case ffmpeg's own argv parser could misread as a flag rather than a filename.
  return path.startsWith("-") ? `./${path}` : path;
}

export interface SceneSplitRange {
  readonly startSec: number;
  readonly endSec: number;
}

// Per-scene-clip architecture Phase 1: extracts ONE scene's [startSec,endSec) range from the
// shared clip into its own standalone output file — same frame-accurate `trim`+`setpts` filter
// cut-private-scenes-argv.ts uses (never `-ss` fast-seek, which would reintroduce the alignment
// bug trim-preroll.ts exists to avoid), just one range per invocation instead of many concatenated
// into one file, since every scene now needs to become its OWN clip (so the assembler can apply a
// LOCAL, correct per-clip fade instead of one gated against the whole shared timeline).
export function buildSceneSplitArgv(
  clipPath: string,
  range: SceneSplitRange,
  outputPath: string,
): string[] {
  return [
    "-y",
    "-i",
    sanitizePositionalPath(clipPath),
    "-vf",
    `trim=start=${range.startSec.toFixed(3)}:end=${range.endSec.toFixed(3)},setpts=PTS-STARTPTS`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    sanitizePositionalPath(outputPath),
  ];
}
