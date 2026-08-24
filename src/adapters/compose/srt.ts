// Pure SRT (SubRip) formatting from domain Subtitle[] — no I/O.
import type { Subtitle } from "../../domain/models/media.js";

// libass override tags make standalone SRT and burned-in captions share compact, safe styling.
const CAPTION_STYLE_BY_PLACEMENT = {
  // Source UI is 1280x720 and then upscaled. Fixed positions keep lower captions in the true
  // bottom safe band (28px from the edge) while top cues stay safely below browser chrome.
  "lower-third": "{\\an2\\pos(640,630)\\fs11\\bord1\\shad0}",
  top: "{\\an8\\pos(640,40)\\fs11\\bord1\\shad0}",
  "bottom-left": "{\\an1\\fs11\\bord1\\shad0}",
  "bottom-right": "{\\an3\\fs11\\bord1\\shad0}",
} as const;
type CaptionPlacement = keyof typeof CAPTION_STYLE_BY_PLACEMENT;
type SubtitleWithPlacement = Subtitle & { readonly placement: CaptionPlacement };

function toTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function toSrt(subtitles: readonly (Subtitle | SubtitleWithPlacement)[]): string {
  return subtitles
    .map((subtitle, index) => {
      const start = toTimestamp(subtitle.startMs);
      const end = toTimestamp(subtitle.startMs + subtitle.durationMs);
      const placement: CaptionPlacement = "placement" in subtitle
        && typeof subtitle.placement === "string"
        && subtitle.placement in CAPTION_STYLE_BY_PLACEMENT
        ? subtitle.placement as CaptionPlacement
        : "lower-third";
      return `${index + 1}\n${start} --> ${end}\n${CAPTION_STYLE_BY_PLACEMENT[placement]}${subtitle.text}\n`;
    })
    .join("\n");
}
