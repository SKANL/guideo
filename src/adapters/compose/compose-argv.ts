// Pure ffmpeg argv builder — no I/O, no process spawning. Every path is emitted as exactly one
// argv array element (never shell-interpolated by the caller), so shell metacharacters in a
// filename are always inert here.
import type { ComposeParams } from "../../domain/ports/platform-profile.js";

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

export function buildComposeArgv(
  params: ComposeParams,
  srtPath: string,
  outputPath: string,
): string[] {
  const narration = params.narration ?? "both";

  if (narration === "subtitles") {
    // No narration audio at all in this mode: silent output (-an, no audio input/map/codec), with
    // subtitles burned directly into the video stream (hardsub) so they're visible without sound.
    return [
      "-y",
      "-i",
      sanitizePositionalPath(params.rawClip.path),
      "-vf",
      `subtitles=${escapeForSubtitlesFilter(srtPath)}`,
      "-map",
      "0:v",
      "-c:v",
      "libx264",
      "-an",
      sanitizePositionalPath(outputPath),
    ];
  }

  const includeSubtitles = narration === "both";
  const audioInputArgs = params.audioTracks.flatMap((audio) => [
    "-i",
    sanitizePositionalPath(audio.path),
  ]);
  const audioLabels = params.audioTracks.map((_, i) => `[${i + 1}:a]`).join("");
  const subtitleInputArgs = includeSubtitles ? ["-i", sanitizePositionalPath(srtPath)] : [];
  const subtitleInputIndex = params.audioTracks.length + 1;

  return [
    "-y",
    "-i",
    sanitizePositionalPath(params.rawClip.path),
    ...audioInputArgs,
    ...subtitleInputArgs,
    "-filter_complex",
    `${audioLabels}concat=n=${params.audioTracks.length}:v=0:a=1[aout]`,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    ...(includeSubtitles ? ["-map", `${subtitleInputIndex}:s`] : []),
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    ...(includeSubtitles ? ["-c:s", "mov_text"] : []),
    "-shortest",
    sanitizePositionalPath(outputPath),
  ];
}
