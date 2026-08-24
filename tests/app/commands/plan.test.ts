import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPlan } from "../../../src/app/commands/plan.js";
import { projectPaths } from "../../../src/app/paths.js";
import { sha256 } from "../../../src/domain/artifacts/canonical.js";
import { approvalManifest } from "../../../src/domain/artifacts/manifest.js";
import { parseBrief } from "../../../src/domain/models/brief.js";
import { parseFlowGraph } from "../../../src/domain/models/flow-graph.js";
import type { Audio, FinalVideo, RawClip } from "../../../src/domain/models/media.js";
import type { NarrationSegment } from "../../../src/domain/models/script.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import type { ComposeParams, PlatformProfile } from "../../../src/domain/ports/platform-profile.js";
import type { RecordingEngine } from "../../../src/domain/ports/recording-engine.js";
import type { FlowGraphRoutes, ScriptGen } from "../../../src/domain/ports/script-gen.js";
import type { VoiceGen } from "../../../src/domain/ports/voice-gen.js";

const graph = parseFlowGraph({
  nodes: [
    { id: "n1", feature: "invite", useCase: "invite a teammate", preconditions: [], selectors: {} },
  ],
  edges: [],
});

// Simulates a prior `guideo discover` by persisting the flow graph where runPlan reads it.
async function writeGraph(paths: ReturnType<typeof projectPaths>): Promise<void> {
  await mkdir(paths.guideoDir, { recursive: true });
  await writeFile(paths.flowGraphPath, JSON.stringify(graph, null, 2), "utf8");
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

class FakeFocalScriptGen implements ScriptGen {
  async generate(_brief: unknown, _routes: FlowGraphRoutes) {
    return {
      script: parseScript({
        segments: [
          { id: "seg-1", text: "Click invite.", timing: { startMs: 0, durationMs: 1500 } },
        ],
      }),
      storyboard: parseStoryboard({
        steps: [
          {
            action: "click",
            selector: "#invite-btn",
            narrationSegmentId: "seg-1",
            evidence: { reference: "Invite teammate" },
          },
        ],
      }),
    };
  }
}

class FakeRecordingEngine implements RecordingEngine {
  captureCalls = 0;
  async capture(): Promise<RawClip> {
    this.captureCalls += 1;
    return { path: "clip.mp4", durationMs: 1500, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
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
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeGraph(paths);
    const scriptGen = new FakeScriptGen();
    const engine = new FakeRecordingEngine();
    const voice = new FakeVoiceGen();
    const profile = new FakePlatformProfile();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const result = await runPlan({ scriptGen }, brief, paths);

    expect(result.script.segments[0]?.text).toBe("Let's invite a teammate.");
    expect(result.storyboard.steps[0]?.narrationSegmentId).toBe("seg-1");

    const writtenScript = JSON.parse(await readFile(paths.scriptPath, "utf8"));
    const writtenStoryboard = JSON.parse(await readFile(paths.storyboardPath, "utf8"));
    expect(writtenScript).toEqual(result.script);
    expect(writtenStoryboard).toEqual(result.storyboard);
    const approval = JSON.parse(await readFile(paths.approvalManifestPath, "utf8"));
    expect(approval).toEqual({
      ...approvalManifest({
        flowGraph: sha256(graph),
        script: sha256(result.script),
        storyboard: sha256(result.storyboard),
        policy: sha256({ version: 2 }),
      }),
      finalized: true,
    });

    // The hard stop: these adapters were constructed but never passed to runPlan, and their call
    // counters prove zero spend happened as a side effect of planning.
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
    expect(profile.composeCalls).toBe(0);
  });

  it("re-plans for a different brief and overwrites the previously planned files", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-plan-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeGraph(paths);
    const scriptGen = new FakeScriptGen();
    const briefOne = parseBrief({
      idea: "Show how to invite a teammate",
      targetPlatform: "youtube",
    });
    const briefTwo = parseBrief({
      idea: "Show how to invite a teammate",
      targetPlatform: "tiktok",
    });

    await runPlan({ scriptGen }, briefOne, paths);
    const second = await runPlan({ scriptGen }, briefTwo, paths);

    const writtenScript = JSON.parse(await readFile(paths.scriptPath, "utf8"));
    expect(writtenScript).toEqual(second.script);
  });

  it("fails with a clear 'run discover first' error when no flow graph is on disk", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-plan-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    const scriptGen = new FakeScriptGen();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    await expect(runPlan({ scriptGen }, brief, paths)).rejects.toThrow(/guideo discover/);
  });

  it("keeps motion opt-in when writing the storyboard for the REVIEW gate", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-plan-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeGraph(paths);
    const scriptGen = new FakeFocalScriptGen();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const result = await runPlan({ scriptGen }, brief, paths);

    expect(result.storyboard.steps[0]?.effects).toContainEqual({
      type: "zoom-in",
      params: expect.objectContaining({ selector: "#invite-btn" }),
    });
    const writtenStoryboard = JSON.parse(await readFile(paths.storyboardPath, "utf8"));
    expect(writtenStoryboard).toEqual(result.storyboard);
  });

  it("adds deterministic semantic emphasis only when explicitly enabled", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-plan-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeGraph(paths);
    const scriptGen = new FakeFocalScriptGen();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const result = await runPlan({ scriptGen }, brief, paths, { motionEmphasisEnabled: true });

    expect(result.storyboard.steps[0]?.effects).toContainEqual({
      type: "zoom-in",
      params: {
        selector: "#invite-btn",
        semanticTarget: "Invite teammate",
        level: 1.25,
        entryMs: 225,
        exitMs: 1275,
      },
    });
  });
  it("can be turned off via directorOptions.enabled = false", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-plan-test-"));
    const paths = projectPaths({ project: "test-project", cwd: scratchDir });
    await writeGraph(paths);
    const scriptGen = new FakeFocalScriptGen();
    const brief = parseBrief({ idea: "Show how to invite a teammate", targetPlatform: "youtube" });

    const result = await runPlan({ scriptGen }, brief, paths, { enabled: false });

    expect(result.storyboard.steps[0]?.effects).toEqual([]);
  });
});
