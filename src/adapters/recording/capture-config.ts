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
  // After a navigation (a "navigate" step, or a click that changed the URL), wait this long for the
  // client-rendered SPA to actually RENDER its content before pacing the scene — otherwise the
  // scene's first frames show a loading skeleton (real e2e: `load` fires before the SPA paints, and
  // we can't use `networkidle` because a persistent chat/websocket never idles). Counts toward the
  // scene's elapsed time. 0 disables it.
  readonly contentSettleMs: number;
  // Narration-driven timing (scene pacing): a scene (consecutive steps sharing a
  // narrationSegmentId) is padded with an extra waitForTimeout to fill its target duration, but
  // never below this floor even if the target itself is smaller.
  readonly minSceneMs: number;
  // Padding is skipped once a scene's elapsed time is already within this tolerance of its target
  // — physical capture never hits an exact millisecond, so don't bother padding for a negligible
  // shortfall.
  readonly timingSlackMs: number;
  // Self-healing capture (design doc section E): bounded retry for a page query/click/hover that
  // races a client-rendered SPA's "Execution context was destroyed" navigation error (shared
  // check: login.ts's isExecutionContextDestroyedError). Any other error is not this race and
  // propagates immediately, unretried.
  readonly stepRetries: number;
  readonly stepRetryWaitMs: number;
  // Bounded poll for a navigate step's URL (or a nav-anchor click's expected navigation) to
  // actually change before the step is declared unverified and a retry/fallback kicks in.
  readonly stepVerifyTimeoutMs: number;
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
  // "load" (page load event), NOT "networkidle": authenticated pages with a persistent connection
  // (chat widget, polling, websockets — e.g. camtom-webapp's support widget) NEVER reach network
  // idle, so `networkidle` times out the navigation at 30s (real e2e). Per-step verification +
  // self-heal (web-recording-engine) handle any not-yet-hydrated content after load.
  navigateWaitUntil: "load",
  contentSettleMs: 1_000,
  minSceneMs: 800,
  timingSlackMs: 250,
  stepRetries: 2,
  stepRetryWaitMs: 300,
  stepVerifyTimeoutMs: 2_000,
};
