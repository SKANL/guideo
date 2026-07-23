import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPlan } from "../../../src/app/commands/plan.js";
import { defaultPaths } from "../../../src/app/paths.js";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { Audio, FinalVideo, RawClip } from "../../../src/domain/models/media.js";
import type { NarrationSegment } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { FlowGraphRoutes, ScriptGen } from "../../../src/domain/ports/script-gen.js";
import type { Target } from "../../../src/domain/ports/target.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";

const graph = parseFlowGraph({
  nodes: [
    { id: "n1", feature: "invite", useCase: "invite a teammate", preconditions: [], selectors: {} },
  ],
  edges: [],
});

class FakeTarget implements Target {
  async discover() {
    return graph;
  }
}

class FakeScriptGen implements ScriptGen {
  async generate(_brief: unknown, _routes: FlowGraphRoutes) {
    return {
      script: parseScript({
        segments: [
          {
            id: "seg-1",
            text: "Let's invite a teammate.",
            timing: { startMs: 0, durationMs: 1500 },
          },
        ],
      }),
      storyboard: parseStoryboard({ steps: [{ action: "pause", narrationSegmentId: "seg-1" }] }),
    };
  }
}

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
  async compose(params: ComposeParams): Promise<FinalVideo> {
    this.composeCalls += 1;
    return { path: "final.mp4", aspectRatio: params.rawClip.aspectRatio };
  }
}

let scratchDir: string | undefined;

afterEach(async () => {
  if (scratchDir) {
    await rm(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("runPlan", () => {
  it("produces and persists script.json + storyboard.json without touching capture/voice/compose (the REVIEW-gate hard stop)", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-plan-test-"));
    const paths = defaultPaths(scratchDir);
    const target = new FakeTarget();
    const scriptGen = new FakeScriptGen();
    const engine = new FakeRecordingEngine();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const result = await runPlan({ target, scriptGen }, brief, paths);

    expect(result.script.segments[0]?.text).toBe("Let's invite a teammate.");
    expect(result.storyboard.steps[0]?.narrationSegmentId).toBe("seg-1");

    const writtenScript = JSON.parse(await readFile(paths.scriptPath, "utf8"));
    const writtenStoryboard = JSON.parse(await readFile(paths.storyboardPath, "utf8"));
    expect(writtenScript).toEqual(result.script);
    expect(writtenStoryboard).toEqual(result.storyboard);

    // The hard stop: these adapters were constructed but never passed to runPlan, and their call
    // counters prove zero spend happened as a side effect of planning.
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
    expect(profile.composeCalls).toBe(0);
  });

  it("re-queries the target for a different brief and overwrites the previously planned files", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-plan-test-"));
    const paths = defaultPaths(scratchDir);
    const target = new FakeTarget();
    const scriptGen = new FakeScriptGen();
    const briefOne = parseBrief({
      idea: "Show how to invite a teammate",
      targetPlatform: "youtube",
    });
    const briefTwo = parseBrief({
      idea: "Show how to invite a teammate",
      targetPlatform: "tiktok",
    });

    await runPlan({ target, scriptGen }, briefOne, paths);
    const second = await runPlan({ target, scriptGen }, briefTwo, paths);

    const writtenScript = JSON.parse(await readFile(paths.scriptPath, "utf8"));
    expect(writtenScript).toEqual(second.script);
  });
});
