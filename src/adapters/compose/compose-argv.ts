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

export function buildComposeArgv(
  params: ComposeParams,
  srtPath: string,
  outputPath: string,
): string[] {
  const audioInputArgs = params.audioTracks.flatMap((audio) => [
    "-i",
    sanitizePositionalPath(audio.path),
  ]);
  const audioLabels = params.audioTracks.map((_, i) => `[${i + 1}:a]`).join("");
  const subtitleInputIndex = params.audioTracks.length + 1;

  return [
    "-y",
    "-i",
    sanitizePositionalPath(params.rawClip.path),
    ...audioInputArgs,
    "-i",
    sanitizePositionalPath(srtPath),
    "-filter_complex",
    `${audioLabels}concat=n=${params.audioTracks.length}:v=0:a=1[aout]`,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-map",
    `${subtitleInputIndex}:s`,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-c:s",
    "mov_text",
    "-shortest",
    sanitizePositionalPath(outputPath),
  ];
}
