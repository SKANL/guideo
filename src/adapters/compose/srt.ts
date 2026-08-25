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
  const { fontSize, outline } = profile.captionStyle;
  // q2 disables libass's automatic wrapping: only serializer-created breaks can become lines.
  return `{\\an${alignment}\\pos(${zone.x},${zone.y})\\q2\\fs${fontSize}\\bord${outline}\\shad0}`;
}

function wrapCaption(text: string, maxCharsPerLine: number): readonly string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && next.length > maxCharsPerLine) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

function captionPages(text: string, profile: RenderProfile): readonly string[] {
  const lines = wrapCaption(text, profile.captionStyle.maxCharsPerLine);
  const pages: string[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    pages.push(lines.slice(index, index + 2).join("\\N"));
  }
  return pages;
}

export function toSrt(subtitles: readonly (Subtitle | SubtitleWithPlacement)[], profile: RenderProfile = PROFESSIONAL_RENDER_PROFILE): string {
  let cueIndex = 0;
  return subtitles.flatMap((subtitle) => {
    const pages = captionPages(subtitle.text, profile);
    const totalWeight = pages.reduce((sum, page) => sum + page.replace(/\\N/g, " ").length, 0);
    let elapsedMs = 0;
    return pages.map((page, pageIndex) => {
      const durationMs = pageIndex === pages.length - 1
        ? subtitle.durationMs - elapsedMs
        : Math.round((subtitle.durationMs * page.replace(/\\N/g, " ").length) / totalWeight);
      const start = toTimestamp(subtitle.startMs + elapsedMs);
      const end = toTimestamp(subtitle.startMs + elapsedMs + durationMs);
      elapsedMs += durationMs;
      const placement: CaptionPlacement = "placement" in subtitle
        && typeof subtitle.placement === "string"
        && ["lower-third", "top", "bottom-left", "bottom-right"].includes(subtitle.placement)
        ? subtitle.placement as CaptionPlacement
        : "lower-third";
      cueIndex += 1;
      return `${cueIndex}\n${start} --> ${end}\n${styleFor(placement, profile)}${page}\n`;
    });
  })
    .join("\n");
}
