import { renderProfileViewport, type DeliveryAspectRatio, type RenderProfileName, type RenderViewport } from "../../domain/models/media.js";

export interface RenderProfile {
  readonly name: RenderProfileName;
  readonly aspectRatio: DeliveryAspectRatio;
  readonly viewport: RenderViewport;
  readonly deviceScaleFactor: number;
  /** Caption coordinates are per profile; the composer never applies one global alignment. */
  readonly captionZones: Readonly<Record<"lower-third" | "top" | "bottom-left" | "bottom-right", { readonly x: number; readonly y: number }>>;
  readonly h264: {
    readonly crf: number;
    readonly preset: string;
    readonly pixelFormat: string;
    readonly movflags: string;
    readonly colorRange: string;
    readonly colorspace: string;
    readonly colorPrimaries: string;
    readonly colorTransfer: string;
  };
}

// Conservative professional default: 1080p at scale 1 keeps browser raster work predictable
// while callers may opt into a denser device scale for capable capture environments.
export const PROFESSIONAL_RENDER_PROFILE: RenderProfile = {
  name: "youtube",
  aspectRatio: "16:9",
  viewport: renderProfileViewport("youtube"),
  deviceScaleFactor: 1,
  // Keep 1280×720 source-space defaults byte-compatible for existing 16:9 SRT consumers.
  captionZones: { "lower-third": { x: 640, y: 630 }, top: { x: 640, y: 40 }, "bottom-left": { x: 72, y: 630 }, "bottom-right": { x: 1_208, y: 630 } },
  h264: {
    crf: 18,
    preset: "slow",
    pixelFormat: "yuv420p",
    movflags: "+faststart",
    colorRange: "tv",
    colorspace: "bt709",
    colorPrimaries: "bt709",
    colorTransfer: "bt709",
  },
};

export const SHORTS_RENDER_PROFILE: RenderProfile = {
  ...PROFESSIONAL_RENDER_PROFILE,
  name: "shorts",
  aspectRatio: "9:16",
  viewport: renderProfileViewport("shorts"),
  captionZones: { "lower-third": { x: 540, y: 1_650 }, top: { x: 540, y: 160 }, "bottom-left": { x: 90, y: 1_650 }, "bottom-right": { x: 990, y: 1_650 } },
};

export const SQUARE_RENDER_PROFILE: RenderProfile = {
  ...PROFESSIONAL_RENDER_PROFILE,
  name: "square",
  aspectRatio: "1:1",
  viewport: renderProfileViewport("square"),
  captionZones: { "lower-third": { x: 540, y: 930 }, top: { x: 540, y: 90 }, "bottom-left": { x: 90, y: 930 }, "bottom-right": { x: 990, y: 930 } },
};

const RENDER_PROFILES: Readonly<Record<RenderProfileName, RenderProfile>> = {
  youtube: PROFESSIONAL_RENDER_PROFILE,
  shorts: SHORTS_RENDER_PROFILE,
  square: SQUARE_RENDER_PROFILE,
};

export function resolveRenderProfile(name: RenderProfileName = "youtube"): RenderProfile {
  return RENDER_PROFILES[name];
}

/**
 * Letterbox/pillarbox instead of crop: a discovered target or postcondition can never be removed
 * merely to fill a social aspect ratio. Source capture is always 16:9.
 */
export function buildFramePreservingFilter(profile: RenderProfile): string | undefined {
  if (profile.name === "youtube") return undefined;
  const { width, height } = profile.viewport;
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
}

export function buildProfessionalH264Args(
  profile: RenderProfile = PROFESSIONAL_RENDER_PROFILE,
): string[] {
  const { h264 } = profile;
  return [
    "-c:v", "libx264",
    "-crf", String(h264.crf),
    "-preset", h264.preset,
    "-pix_fmt", h264.pixelFormat,
    "-movflags", h264.movflags,
    "-color_range", h264.colorRange,
    "-colorspace", h264.colorspace,
    "-color_primaries", h264.colorPrimaries,
    "-color_trc", h264.colorTransfer,
  ];
}
