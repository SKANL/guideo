import ffmpegStaticDefault from "ffmpeg-static";

// ponytail: ffmpeg-static's shipped .d.ts declares an ESM `export default` for what is actually
// a CommonJS module (`module.exports = path`). Under this project's NodeNext module resolution,
// that mismatch makes the default import's inferred type resolve to the whole module namespace
// instead of the declared `string | null` — a known TS/CJS-interop quirk, not our bug. The value
// at runtime genuinely is `string | null`; the cast only fixes the type.
const ffmpegStaticPath = ffmpegStaticDefault as unknown as string | null;

export function resolveFfmpegPath(): string {
  const override = process.env.GUIDEO_FFMPEG_PATH;
  if (override) {
    return override;
  }
  if (!ffmpegStaticPath) {
    throw new Error(
      "ffmpeg-static did not resolve a bundled binary for this platform; set GUIDEO_FFMPEG_PATH.",
    );
  }
  return ffmpegStaticPath;
}
