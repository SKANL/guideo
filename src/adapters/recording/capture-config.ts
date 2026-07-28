import { tmpdir } from "node:os";
import type { WaitUntil } from "../target/login.js";

// Non-human-feel capture knobs — where video lands, viewport size, and where the (virtual) mouse
// starts. Tunable per-instance via WebRecordingEngine's constructor, same pattern as
// DiscoveryConfig/HumanFeelConfig.
export interface CaptureConfig {
  // Parent directory patchright writes the raw video recording into. A fresh subdirectory is
  // created per capture() call so concurrent/repeated captures never collide.
  readonly videoDir: string;
  // 16:9 by default — spec requires a platform-agnostic 16:9-ish raw clip (compose reframes it).
  readonly viewport: { readonly width: number; readonly height: number };
  readonly initialMousePosition: { readonly x: number; readonly y: number };
  // Real e2e finding: an onboarding/welcome Radix dialog covers the nav and intercepts every
  // click. When true, capture() presses `dismissKey` `dismissPresses` times (after login and
  // after each navigate step) to clear it before interacting with the page.
  readonly dismissOverlays: boolean;
  readonly dismissKey: string;
  readonly dismissPresses: number;
  readonly dismissWaitMs: number;
  // How goto() waits for a "navigate" step to settle — client-rendered SPAs need "networkidle" (or
  // at least "load"); "domcontentloaded" fires before hydration.
  readonly navigateWaitUntil: WaitUntil;
  // Narration-driven timing (scene pacing): a scene (consecutive steps sharing a
  // narrationSegmentId) is padded with an extra waitForTimeout to fill its target duration, but
  // never below this floor even if the target itself is smaller.
  readonly minSceneMs: number;
  // Padding is skipped once a scene's elapsed time is already within this tolerance of its target
  // — physical capture never hits an exact millisecond, so don't bother padding for a negligible
  // shortfall.
  readonly timingSlackMs: number;
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  // ponytail: os.tmpdir() default, cross-platform, no cleanup logic here — override videoDir for
  // a persistent capture directory if the caller wants to keep raw clips around.
  videoDir: tmpdir(),
  viewport: { width: 1280, height: 720 },
  initialMousePosition: { x: 0, y: 0 },
  dismissOverlays: true,
  dismissKey: "Escape",
  dismissPresses: 2,
  dismissWaitMs: 300,
  navigateWaitUntil: "networkidle",
  minSceneMs: 800,
  timingSlackMs: 250,
};
