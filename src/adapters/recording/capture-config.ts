import { tmpdir } from "node:os";

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
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  // ponytail: os.tmpdir() default, cross-platform, no cleanup logic here — override videoDir for
  // a persistent capture directory if the caller wants to keep raw clips around.
  videoDir: tmpdir(),
  viewport: { width: 1280, height: 720 },
  initialMousePosition: { x: 0, y: 0 },
};
