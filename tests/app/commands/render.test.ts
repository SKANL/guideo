import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElevenLabsVoice } from "../../../src/adapters/voice/elevenlabs-voice.js";
import { runRender } from "../../../src/app/commands/render.js";
import { projectPaths } from "../../../src/app/paths.js";
import type { Audio, FinalVideo, RawClip } from "../../../src/domain/models/media.js";
import type { NarrationSegment } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";

const script = parseScript({
  segments: [
    { id: "seg-1", text: "Let's invite a teammate.", timing: { startMs: 0, durationMs: 1500 } },
  ],
});
const storyboard = parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] });

class FakeRecordingEngine implements RecordingEngine {
  captureCalls = 0;
  async capture(): Promise<RawClip> {
    this.captureCalls += 1;
    return { path: "clip.mp4", durationMs: 1500, aspectRatio: "16:9" };
  }
}

class FakeVoiceGen implements VoiceGen {
  synthesizeCalls = 0;
  async synthesize(segment: NarrationSegment): Promise<Audio> {
    this.synthesizeCalls += 1;
    return {
      segmentId: segment.id,
      path: `${segment.id}.mp3`,
      durationMs: segment.timing.durationMs,
    };
  }
}

class FakePlatformProfile implements PlatformProfile {
  composeCalls = 0;
  lastParams: ComposeParams | undefined;
  async compose(params: ComposeParams): Promise<FinalVideo> {
    this.composeCalls += 1;
    this.lastParams = params;
    return { path: "final.mp4", aspectRatio: params.rawClip.aspectRatio };
  }
}

let scratchDir: string | undefined;

async function writeApprovedFixtures(paths: ReturnType<typeof projectPaths>): Promise<void> {
  await mkdir(paths.guideoDir, { recursive: true });
  await writeFile(paths.scriptPath, JSON.stringify(script), "utf8");
  await writeFile(paths.storyboardPath, JSON.stringify(storyboard), "utf8");
}

afterEach(async () => {
  if (scratchDir) {
    await rm(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("runRender", () => {
  it("refuses without --approve and never calls capture/synthesize/compose (no spend)", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const engine = new FakeRecordingEngine();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();

    await expect(
      runRender(
        { recordingEngine: engine, voiceGen: voice, platformProfile: profile },
        false,
        paths,
      ),
    ).rejects.toThrow(/--approve/);

    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
    expect(profile.composeCalls).toBe(0);
  });

  it("with --approve, mints the ApprovedStoryboard and renders exactly once through each adapter", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeApprovedFixtures(paths);
    const engine = new FakeRecordingEngine();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();

    const video = await runRender(
      { recordingEngine: engine, voiceGen: voice, platformProfile: profile },
      true,
      paths,
    );

    expect(video).toEqual({ path: "final.mp4", aspectRatio: "16:9" });
    expect(engine.captureCalls).toBe(1);
    expect(voice.synthesizeCalls).toBe(1);
    expect(profile.composeCalls).toBe(1);
    // The pipeline must hand the STABLE project output path to compose(), not let the adapter
    // pick its own (temp-dir) path.
    expect(profile.lastParams?.outputPath).toBe(paths.outputPath);
  });

  describe("missing ELEVENLABS_API_KEY", () => {
    const originalKey = process.env.ELEVENLABS_API_KEY;

    beforeEach(() => {
      delete process.env.ELEVENLABS_API_KEY;
    });

    afterEach(() => {
      if (originalKey === undefined) {
        delete process.env.ELEVENLABS_API_KEY;
      } else {
        process.env.ELEVENLABS_API_KEY = originalKey;
      }
    });

    it("surfaces a clear error instead of failing silently when render needs voice synthesis and no key is set", async () => {
      scratchDir = await mkdtemp(join(tmpdir(), "guideo-render-test-"));
      const paths = projectPaths({ project: "test-project", cwd: scratchDir });
      await writeApprovedFixtures(paths);
      const engine = new FakeRecordingEngine();
      const profile = new FakePlatformProfile();
      // Real ElevenLabsVoice, no injected client, no env key: throws before any network call.
      const voice = new ElevenLabsVoice();

      await expect(
        runRender(
          { recordingEngine: engine, voiceGen: voice, platformProfile: profile },
          true,
          paths,
        ),
      ).rejects.toThrow(/ELEVENLABS_API_KEY/);
    });
  });
});
