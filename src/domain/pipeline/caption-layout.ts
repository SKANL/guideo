import type { EffectRegion } from "../models/media.js";

export type CaptionPlacement = "lower-third" | "top" | "bottom-left" | "bottom-right";

export interface CaptionViewport {
  readonly width: number;
  readonly height: number;
}

export interface CaptionSafeRegion extends EffectRegion {
  readonly placement: CaptionPlacement;
}

const LEGACY_VIEWPORT: CaptionViewport = { width: 1280, height: 720 };
const PLACEMENT_ORDER: readonly CaptionPlacement[] = ["lower-third", "top", "bottom-left", "bottom-right"];

/**
 * Produces action-safe rectangles from the actual delivery viewport. The ratios preserve the
 * established 1280x720 lower-third geometry when callers omit the profile viewport.
 */
export function captionSafeRegions(viewport: CaptionViewport = LEGACY_VIEWPORT): readonly CaptionSafeRegion[] {
  const { width, height } = viewport;
  const pixel = (value: number): number => Math.round(value);
  return [
    { placement: "lower-third", x: pixel(width * 0.075), y: pixel(height * (17 / 24)), w: pixel(width * 0.85), h: pixel(height * (5 / 24)) },
    { placement: "top", x: pixel(width * 0.075), y: pixel(height / 18), w: pixel(width * 0.85), h: pixel(height * (5 / 24)) },
    { placement: "bottom-left", x: pixel(width * 0.05625), y: pixel(height * (17 / 24)), w: pixel(width * 0.425), h: pixel(height * (5 / 24)) },
    { placement: "bottom-right", x: pixel(width * 0.51875), y: pixel(height * (17 / 24)), w: pixel(width * 0.425), h: pixel(height * (5 / 24)) },
  ];
}

/** Maps capture-space rectangles through the same fit-and-pad composition used for delivery. */
export function projectOccupiedRegions(
  regions: readonly EffectRegion[],
  viewport: CaptionViewport,
  sourceViewport: CaptionViewport = LEGACY_VIEWPORT,
): readonly EffectRegion[] {
  const scale = Math.min(viewport.width / sourceViewport.width, viewport.height / sourceViewport.height);
  const offsetX = (viewport.width - sourceViewport.width * scale) / 2;
  const offsetY = (viewport.height - sourceViewport.height * scale) / 2;
  return regions.map((region) => ({
    x: Math.round(offsetX + region.x * scale),
    y: Math.round(offsetY + region.y * scale),
    w: Math.round(region.w * scale),
    h: Math.round(region.h * scale),
  }));
}

function intersects(left: EffectRegion, right: EffectRegion): boolean {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

function intersectionArea(left: EffectRegion, right: EffectRegion): number {
  if (!intersects(left, right)) return 0;
  const width = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);
  return width * height;
}

/**
 * Selects the least-occupied profile-safe region. The fixed tie order preserves deterministic
 * legacy lower-third output whenever all candidates are equally clear or equally blocked.
 */
export function selectCaptionPlacement(
  occupiedRegions: readonly EffectRegion[] | undefined,
  viewport?: CaptionViewport,
): CaptionPlacement {
  const regionsByPlacement = new Map(captionSafeRegions(viewport).map((region) => [region.placement, region]));
  return PLACEMENT_ORDER.reduce((best, placement) => {
    const score = (occupiedRegions ?? []).reduce(
      (total, occupied) => total + intersectionArea(regionsByPlacement.get(placement)!, occupied),
      0,
    );
    return score < best.score ? { placement, score } : best;
  }, { placement: "lower-third" as CaptionPlacement, score: Number.POSITIVE_INFINITY }).placement;
}
