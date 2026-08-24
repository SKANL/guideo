// Pure SRT (SubRip) formatting from domain Subtitle[] — no I/O.
import type { Subtitle } from "../../domain/models/media.js";
import { PROFESSIONAL_RENDER_PROFILE, type RenderProfile } from "./render-profile.js";

type CaptionPlacement = "lower-third" | "top" | "bottom-left" | "bottom-right";
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

function styleFor(placement: CaptionPlacement, profile: RenderProfile): string {
  const zone = profile.captionZones[placement];
  const alignment = placement === "top" ? "8" : placement === "bottom-left" ? "1" : placement === "bottom-right" ? "3" : "2";
  return `{\\an${alignment}\\pos(${zone.x},${zone.y})\\fs11\\bord1\\shad0}`;
}

export function toSrt(subtitles: readonly (Subtitle | SubtitleWithPlacement)[], profile: RenderProfile = PROFESSIONAL_RENDER_PROFILE): string {
  return subtitles
    .map((subtitle, index) => {
      const start = toTimestamp(subtitle.startMs);
      const end = toTimestamp(subtitle.startMs + subtitle.durationMs);
      const placement: CaptionPlacement = "placement" in subtitle
        && typeof subtitle.placement === "string"
        && ["lower-third", "top", "bottom-left", "bottom-right"].includes(subtitle.placement)
        ? subtitle.placement as CaptionPlacement
        : "lower-third";
      return `${index + 1}\n${start} --> ${end}\n${styleFor(placement, profile)}${subtitle.text}\n`;
    })
    .join("\n");
}
