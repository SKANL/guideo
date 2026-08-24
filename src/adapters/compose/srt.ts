// Pure SRT (SubRip) formatting from domain Subtitle[] — no I/O.
import type { Subtitle } from "../../domain/models/media.js";

// libass override tags make the SRT cues compact and consistent in burned-in subtitle renders.
const CAPTION_STYLE = "{\\an2\\fs18\\bord1\\shad1}";

function toTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function toSrt(subtitles: readonly Subtitle[]): string {
  return subtitles
    .map((subtitle, index) => {
      const start = toTimestamp(subtitle.startMs);
      const end = toTimestamp(subtitle.startMs + subtitle.durationMs);
      return `${index + 1}\n${start} --> ${end}\n${CAPTION_STYLE}${subtitle.text}\n`;
    })
    .join("\n");
}
