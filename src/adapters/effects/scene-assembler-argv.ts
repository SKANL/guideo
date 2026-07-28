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

function buildDipFilterComplex(
  clips: readonly SceneAssembleClipInput[],
  transitionDurationSec: number,
): string {
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
  return `${chains.join(";")};${concatInputs}concat=n=${clips.length}:v=1:a=0[vout]`;
}

// Real crossfade: chains ffmpeg's `xfade` filter left-to-right, each transition OVERLAPPING the
// running (already-merged) stream with the next clip by transitionDurationSec. `offset` is the
// timestamp in the running stream at which THAT transition starts — i.e. sum(durations of clips
// merged so far) minus every transitionDurationSec already consumed by prior transitions. This is
// the exact same value as scene k's overlap-adjusted startMs (see ffmpeg-scene-assembler.ts's
// rebaseScenesXfade) by construction: a scene begins exactly when its clip starts crossfading in.
// Clamped to >= 0 (ffmpeg's own xfade filter has no defined behavior for a negative offset) —
// only reachable if a clip is shorter than the configured transition duration.
function buildXfadeFilterComplex(
  clips: readonly SceneAssembleClipInput[],
  transitionDurationSec: number,
): string {
  if (clips.length === 1) {
    return "[0:v]null[c0];[c0]concat=n=1:v=1:a=0[vout]";
  }
  let accumulatedSec = clips[0]?.durationSec ?? 0;
  const transitions = clips.slice(1).map((clip, idx) => {
    const isLast = idx === clips.length - 2;
    const inLabel = idx === 0 ? "[0:v]" : `[x${idx - 1}]`;
    const outLabel = isLast ? "[vout]" : `[x${idx}]`;
    const offsetSec = Math.max(0, accumulatedSec - transitionDurationSec);
    accumulatedSec = accumulatedSec + clip.durationSec - transitionDurationSec;
    return `${inLabel}[${idx + 1}:v]xfade=transition=fade:duration=${transitionDurationSec}:offset=${offsetSec.toFixed(3)}${outLabel}`;
  });
  return transitions.join(";");
}

// Per-scene-clip architecture: composes N standalone scene clips into ONE assembled clip.
// style="xfade" (real crossfade, default at the FfmpegSceneAssembler level) chains ffmpeg's
// `xfade` filter so consecutive clips genuinely OVERLAP by transitionDurationSec — total duration
// shrinks to sum(durations) − (N−1)·transitionDurationSec. style="dip" (the original fallback) is
// duration-preserving: each fade is LOCAL to its own scene clip's input stream ([i:v]) — never
// gated against the shared/assembled timeline the way the old single-clip `fade=in:st=T` was (that
// blacked out everything before T across the WHOLE video; see director.ts's history) — then concat
// joins the (already locally-faded) clips back-to-back with NO overlap.
export function buildSceneAssembleArgv(
  clips: readonly SceneAssembleClipInput[],
  transitionDurationSec: number,
  outputPath: string,
  style: "dip" | "xfade" = "dip",
): string[] {
  const inputArgs = clips.flatMap((clip) => ["-i", sanitizePositionalPath(clip.path)]);
  const filterComplex =
    style === "xfade"
      ? buildXfadeFilterComplex(clips, transitionDurationSec)
      : buildDipFilterComplex(clips, transitionDurationSec);

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
