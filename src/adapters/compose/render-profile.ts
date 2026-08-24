export interface RenderProfile {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
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
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
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
