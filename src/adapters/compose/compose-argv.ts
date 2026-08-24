// Pure ffmpeg argv builder — no I/O, no process spawning. Every path is emitted as exactly one
// argv array element (never shell-interpolated by the caller), so shell metacharacters in a
// filename are always inert here.
import type { ComposeParams } from "../../domain/ports/platform-profile.js";
import { buildFramePreservingFilter, buildProfessionalH264Args, resolveRenderProfile } from "./render-profile.js";

function sanitizePositionalPath(path: string): string {
  // A leading "-" is the only case ffmpeg's own argv parser could misread as a flag rather than
  // a filename (relevant for -i's argument and the trailing output path alike). "./"-prefixing
  // keeps it pointing at the same file while making it unambiguously positional.
  return path.startsWith("-") ? `./${path}` : path;
}

// ffmpeg's `subtitles` filter parses its value as `subtitles=path:options`, so a bare ':' inside
// the path is misread as an option separator — this bites every Windows drive-letter path
// (`C:\...`) even though it's already a single argv element (execFile never spawns a shell, so
// this is ffmpeg's OWN filtergraph parser, not a shell-injection concern). Escape backslashes and
// colons, then single-quote the whole value so the outer filtergraph parser's other special chars
// (comma, brackets, `=`) are inert too; any literal single quote in the path is escaped in turn.
function escapeForSubtitlesFilter(path: string): string {
  const escaped = path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// Bottom-center captions remain within the 1080p action-safe area and use a restrained readable
// size. This applies only to hardsubs; soft subtitle tracks preserve user-player styling.
// Do not force Alignment here: each SRT cue's \an override is the authoritative safe placement.
const BURNED_CAPTION_STYLE = "Fontsize=11,MarginV=28,MarginL=72,MarginR=72,Outline=1,Shadow=0";

function burnedSubtitleFilter(path: string): string {
  return `subtitles=${escapeForSubtitlesFilter(path)}:force_style='${BURNED_CAPTION_STYLE}'`;
}

// Compares each audio track's scene startMs (from RawClip.scenes, matched by segmentId) against
// the naive back-to-back concat cumulative offset (sum of PRECEDING tracks' own durations). With
// "dip" assembly (contiguous scenes, no overlap) these always match, so the plain concat filter
// stays byte-identical to before this feature existed. With "xfade" assembly the video timeline
// shrinks — each scene starts EARLIER than the naive cumulative sum by the overlap already
// consumed — so audio must be placed at the real scene startMs (adelay) instead of concatenated
// back-to-back, or narration drifts ahead of the (shrinking) video. Returns null when every offset
// matches (use the legacy concat filter unchanged); otherwise the per-track offsets to adelay by.
function computeOverlapAdjustedOffsetsMs(
  audioTracks: ComposeParams["audioTracks"],
  scenes: ComposeParams["rawClip"]["scenes"],
): number[] | null {
  if (audioTracks.length === 0) return null;
  const sceneBySegmentId = new Map(scenes.map((scene) => [scene.narrationSegmentId, scene]));
  let cumulativeMs = 0;
  let anyOverlap = false;
  const offsets = audioTracks.map((track) => {
    const scene = sceneBySegmentId.get(track.segmentId);
    const offset = scene?.startMs ?? cumulativeMs;
    if (scene !== undefined && Math.round(scene.startMs) !== Math.round(cumulativeMs)) {
      anyOverlap = true;
    }
    cumulativeMs += track.durationMs;
    return offset;
  });
  return anyOverlap ? offsets : null;
}

// Real crossfade (overlap-adjusted) audio path: each track gets its own `adelay` to its scene's
// real startMs (skipped — via ffmpeg's `anull` identity filter — for an offset of 0, i.e. always
// the first track), then every delayed track is summed with `amix` (normalize=0 so N simultaneous
// tracks aren't quietened; overlapping narration briefly playing together during a crossfade window
// is the accepted tradeoff of this simplification — see design doc).
function buildAdelayAmixFilter(
  audioTracks: ComposeParams["audioTracks"],
  offsetsMs: readonly number[],
  firstInputIndex: number,
): string {
  const delayed = audioTracks.map((_, i) => {
    const inputLabel = `[${firstInputIndex + i}:a]`;
    const offsetMs = offsetsMs[i] ?? 0;
    const filter = offsetMs > 0 ? `adelay=${Math.round(offsetMs)}:all=1` : "anull";
    return `${inputLabel}${filter}[a${i}]`;
  });
  const mixInputs = audioTracks.map((_, i) => `[a${i}]`).join("");
  return `${delayed.join(";")};${mixInputs}amix=inputs=${audioTracks.length}:duration=longest:normalize=0[aout]`;
}

export function buildComposeArgv(
  params: ComposeParams,
  srtPath: string,
  outputPath: string,
): string[] {
  const narration = params.narration ?? "both";
  const profile = resolveRenderProfile(params.renderProfile);
  const frameFilter = buildFramePreservingFilter(profile);

  if (narration === "subtitles" || narration === "silent") {
    // No narration audio at all in this mode: silent output (-an, no audio input/map/codec), with
    // subtitles burned directly into the video stream (hardsub) so they're visible without sound.
    return [
      "-y",
      "-i",
      sanitizePositionalPath(params.rawClip.path),
      ...((narration === "subtitles" || frameFilter) ? ["-vf", [frameFilter, narration === "subtitles" ? burnedSubtitleFilter(srtPath) : undefined].filter((value): value is string => Boolean(value)).join(",")] : []),
      "-map",
      "0:v",
      ...buildProfessionalH264Args(),
      "-an",
      sanitizePositionalPath(outputPath),
    ];
  }

  const includeSubtitles = narration === "both";
  const audioInputArgs = params.audioTracks.flatMap((audio) => [
    "-i",
    sanitizePositionalPath(audio.path),
  ]);
  const subtitleInputArgs = includeSubtitles ? ["-i", sanitizePositionalPath(srtPath)] : [];
  const subtitleInputIndex = params.audioTracks.length + 1;

  const overlapOffsetsMs = computeOverlapAdjustedOffsetsMs(
    params.audioTracks,
    params.rawClip.scenes,
  );
  const audioFilterComplex =
    overlapOffsetsMs !== null
      ? buildAdelayAmixFilter(params.audioTracks, overlapOffsetsMs, 1)
      : `${params.audioTracks.map((_, i) => `[${i + 1}:a]`).join("")}concat=n=${params.audioTracks.length}:v=0:a=1[aout]`;

  return [
    "-y",
    "-i",
    sanitizePositionalPath(params.rawClip.path),
    ...audioInputArgs,
    ...subtitleInputArgs,
    ...(frameFilter ? ["-vf", frameFilter] : []),
    "-filter_complex",
    audioFilterComplex,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    ...(includeSubtitles ? ["-map", `${subtitleInputIndex}:s`] : []),
    ...buildProfessionalH264Args(),
    "-c:a",
    "aac",
    ...(includeSubtitles ? ["-c:s", "mov_text"] : []),
    "-shortest",
    sanitizePositionalPath(outputPath),
  ];
}
