// Pure ffmpeg argv builder — no I/O, no process spawning. Mirrors cut-private-scenes-argv.ts's/
// scene-splitter-argv.ts's discipline: every path is emitted as exactly one argv array element
// (never shell-interpolated by the caller), so shell metacharacters in a filename are always inert
// here.

function sanitizePositionalPath(path: string): string {
  // Same rationale as scene-splitter-argv.ts's sanitizePositionalPath: a leading "-" is the only
  // case ffmpeg's own argv parser could misread as a flag rather than a filename.
  return path.startsWith("-") ? `./${path}` : path;
}

export interface SceneAssembleClipInput {
  readonly path: string;
  readonly durationSec: number;
}

// Per-scene-clip architecture Phase 1: composes N standalone scene clips into ONE assembled clip
// with a duration-preserving dip transition at every boundary. Each fade is LOCAL to its own scene
// clip's input stream ([i:v]) — never gated against the shared/assembled timeline the way the old
// single-clip `fade=in:st=T` was (that blacked out everything before T across the WHOLE video; see
// director.ts's history). clip N's own fade-out and clip N+1's own fade-in each only ever touch
// that clip's own frames, so this is correct by construction. Concat then joins the (already
// locally-faded) clips back-to-back with NO overlap, so total duration is always exactly the sum
// of the inputs' durations — audio/subtitles derived from Script/Audio timing stay aligned.
export function buildSceneAssembleArgv(
  clips: readonly SceneAssembleClipInput[],
  transitionDurationSec: number,
  outputPath: string,
): string[] {
  const inputArgs = clips.flatMap((clip) => ["-i", sanitizePositionalPath(clip.path)]);
  const chains = clips.map((clip, i) => {
    const isFirst = i === 0;
    const isLast = i === clips.length - 1;
    const fades: string[] = [];
    if (!isFirst) {
      fades.push(`fade=t=in:st=0:d=${transitionDurationSec}`);
    }
    if (!isLast) {
      const fadeOutStart = clip.durationSec - transitionDurationSec;
      fades.push(`fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${transitionDurationSec}`);
    }
    // "null" is ffmpeg's identity video filter — needed so every input still lands on a labeled
    // link ([c0], [c1], ...) for concat below, even when a clip (a lone single clip; never happens
    // for first/last with 2+ clips since one of the two fades always applies then) gets no fade.
    const filter = fades.length > 0 ? fades.join(",") : "null";
    return `[${i}:v]${filter}[c${i}]`;
  });
  const concatInputs = clips.map((_, i) => `[c${i}]`).join("");
  const filterComplex = `${chains.join(";")};${concatInputs}concat=n=${clips.length}:v=1:a=0[vout]`;

  return [
    "-y",
    ...inputArgs,
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
