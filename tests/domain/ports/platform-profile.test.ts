import { describe, expect, it } from "vitest";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";

class FakeYouTubeProfile implements PlatformProfile {
  // Deferred seam (non-goal): metrics is typed but intentionally left unset — no producer
  // exists this slice. Proves the port does not force adapters to implement it.
  async compose(params: ComposeParams) {
    return { path: "final.mp4", aspectRatio: params.rawClip.aspectRatio };
  }
}

describe("PlatformProfile port", () => {
  it("composes a raw clip, audio tracks, and subtitles into a FinalVideo", async () => {
    const profile: PlatformProfile = new FakeYouTubeProfile();
    const finalVideo = await profile.compose({
      rawClip: { path: "clip.mp4", durationMs: 1000, aspectRatio: "16:9" },
      audioTracks: [{ segmentId: "seg-1", path: "seg-1.mp3", durationMs: 1000 }],
      subtitles: [{ text: "Let's log in.", startMs: 0, durationMs: 1000 }],
      outputPath: "final.mp4",
    });
    expect(finalVideo.aspectRatio).toBe("16:9");
    expect(profile.metrics).toBeUndefined();
  });
});
