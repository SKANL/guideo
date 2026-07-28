// Pure ffmpeg argv builder — no I/O, no process spawning. Mirrors effects-argv.ts's/
// trim-preroll-argv.ts's discipline: every path is emitted as exactly one argv array element
// (never shell-interpolated by the caller), so shell metacharacters in a filename are always inert
// here.

function sanitizePositionalPath(path: string): string {
  // Same rationale as trim-preroll-argv.ts's sanitizePositionalPath: a leading "-" is the only case
  // ffmpeg's own argv parser could misread as a flag rather than a filename.
  return path.startsWith("-") ? `./${path}` : path;
}

export interface CutRange {
  readonly startSec: number;
  readonly endSec: number;
}

// One trim+setpts fragment per KEPT range (accurate/frame-level trim, same "-ss after -i"
// rationale as trim-preroll-argv.ts — a filter-graph trim is inherently frame-accurate, unlike
// stream-copy concat demuxing), concatenated video-only into a single [vout]. Audio is handled
// separately downstream (compose concatenates the per-segment narration Audio tracks; the raw
// capture clip carries no useful audio track).
export function buildCutPrivateScenesArgv(
  clipPath: string,
  ranges: readonly CutRange[],
  outputPath: string,
): string[] {
  const trims = ranges.map(
    (range, i) =>
      `[0:v]trim=start=${range.startSec.toFixed(3)}:end=${range.endSec.toFixed(3)},setpts=PTS-STARTPTS[c${i}]`,
  );
  const concatInputs = ranges.map((_, i) => `[c${i}]`).join("");
  const filterComplex = `${trims.join(";")};${concatInputs}concat=n=${ranges.length}:v=1:a=0[vout]`;

  return [
    "-y",
    "-i",
    sanitizePositionalPath(clipPath),
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    sanitizePositionalPath(outputPath),
  ];
}
