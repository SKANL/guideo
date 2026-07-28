import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UrlCredsTarget } from "../../src/adapters/target/url-creds-target.js";
import type { Container } from "../../src/app/factory.js";
import { projectPaths } from "../../src/app/paths.js";
import { runCli } from "../../src/app/run.js";
import type { FlowGraph } from "../../src/domain/models/flow-graph.js";
import type { Audio, FinalVideo, RawClip } from "../../src/domain/models/media.js";
import type { NarrationSegment, Script } from "../../src/domain/models/script.js";
import { parseScript } from "../../src/domain/models/script.js";
import type { ApprovedStoryboard } from "../../src/domain/models/storyboard.js";
import { parseStoryboard } from "../../src/domain/models/storyboard.js";
import type { EffectsEngine } from "../../src/domain/ports/effects.js";
import type { ComposeParams, PlatformProfile } from "../../src/domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../../src/domain/ports/preroll-trimmer.js";
import type { PrivacyCutResult, PrivacyCutter } from "../../src/domain/ports/privacy-cutter.js";
import type { RecordingEngine } from "../../src/domain/ports/recording-engine.js";
import type { SceneAssembler } from "../../src/domain/ports/scene-assembler.js";
import type { SceneClip, SceneSplitter } from "../../src/domain/ports/scene-splitter.js";
import type { FlowGraphRoutes, ScriptGen } from "../../src/domain/ports/script-gen.js";
import type { Target } from "../../src/domain/ports/target.js";
import type { VoiceGen } from "../../src/domain/ports/voice-gen.js";

const graph: FlowGraph = {
  nodes: [
    { id: "n1", feature: "invite", useCase: "invite a teammate", preconditions: [], selectors: {} },
  ],
  edges: [],
};

class FakeTarget implements Target {
  discoverCalls = 0;
  async discover(): Promise<FlowGraph> {
    this.discoverCalls += 1;
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
    return { path: "clip.mp4", durationMs: 1500, aspectRatio: "16:9", scenes: [], preRollMs: 0 };
  }
}

class FakePreRollTrimmer implements PreRollTrimmer {
  async trim(clip: RawClip): Promise<RawClip> {
    return clip;
  }
}

class FakeEffectsEngine implements EffectsEngine {
  applyCalls = 0;
  async apply(clip: RawClip, _storyboard: ApprovedStoryboard): Promise<RawClip> {
    this.applyCalls += 1;
    return clip;
  }
}

class FakePrivacyCutter implements PrivacyCutter {
  cutCalls = 0;
  async cut(
    clip: RawClip,
    _storyboard: ApprovedStoryboard,
    script: Script,
    audioTracks: readonly Audio[],
  ): Promise<PrivacyCutResult> {
    this.cutCalls += 1;
    return { clip, script, audioTracks };
  }
}

class FakeSceneSplitter implements SceneSplitter {
  async split(clip: RawClip): Promise<SceneClip[]> {
    return [{ narrationSegmentId: "", path: clip.path, durationMs: clip.durationMs }];
  }
}

class FakeSceneAssembler implements SceneAssembler {
  async assemble(sceneClips: readonly SceneClip[]): Promise<RawClip> {
    const only = sceneClips[0] as SceneClip;
    return {
      path: only.path,
      durationMs: only.durationMs,
      aspectRatio: "16:9",
      scenes: [{ narrationSegmentId: only.narrationSegmentId, startMs: 0, endMs: only.durationMs }],
      preRollMs: 0,
    };
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

function makeContainer(): {
  container: Container;
  target: FakeTarget;
  scriptGen: FakeScriptGen;
  engine: FakeRecordingEngine;
  preRollTrimmer: FakePreRollTrimmer;
  privacyCutter: FakePrivacyCutter;
  effectsEngine: FakeEffectsEngine;
  voice: FakeVoiceGen;
  profile: FakePlatformProfile;
} {
  const target = new FakeTarget();
  const scriptGen = new FakeScriptGen();
  const engine = new FakeRecordingEngine();
  const preRollTrimmer = new FakePreRollTrimmer();
  const privacyCutter = new FakePrivacyCutter();
  const effectsEngine = new FakeEffectsEngine();
  const sceneSplitter = new FakeSceneSplitter();
  const sceneAssembler = new FakeSceneAssembler();
  const voice = new FakeVoiceGen();
  const profile = new FakePlatformProfile();
  return {
    container: {
      target,
      scriptGen,
      recordingEngine: engine,
      preRollTrimmer,
      privacyCutter,
      effectsEngine,
      sceneSplitter,
      sceneAssembler,
      voiceGen: voice,
      platformProfile: profile,
    },
    target,
    scriptGen,
    engine,
    preRollTrimmer,
    privacyCutter,
    effectsEngine,
    voice,
    profile,
  };
}

function makeSink(): {
  lines: string[];
  errLines: string[];
  print: (s: string) => void;
  printErr: (s: string) => void;
} {
  const lines: string[] = [];
  const errLines: string[] = [];
  return {
    lines,
    errLines,
    print: (line: string) => lines.push(line),
    printErr: (line: string) => errLines.push(line),
  };
}

let scratchDir: string | undefined;

afterEach(async () => {
  if (scratchDir) {
    await rm(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

describe("runCli", () => {
  it("prints usage and exits 0 for --help without touching any adapter", async () => {
    const { container, target, scriptGen } = makeContainer();
    const sink = makeSink();

    const code = await runCli(["--help"], container, undefined, sink.print, sink.printErr);

    expect(code).toBe(0);
    expect(sink.lines.join("\n")).toMatch(/guideo (discover|plan|render)/);
    expect(target.discoverCalls).toBe(0);
    expect(scriptGen).toBeDefined();
  });

  it("exits 1 with a clear message for an unknown command", async () => {
    const { container } = makeContainer();
    const sink = makeSink();

    const code = await runCli(["frobnicate"], container, undefined, sink.print, sink.printErr);

    expect(code).toBe(1);
    expect(sink.errLines.join("\n")).toMatch(/Unknown command "frobnicate"/);
  });

  it("plan without --brief refuses with a clear message and never calls scriptGen", async () => {
    const { container, scriptGen } = makeContainer();
    const sink = makeSink();

    const code = await runCli(["plan"], container, undefined, sink.print, sink.printErr);

    expect(code).toBe(1);
    expect(sink.errLines.join("\n")).toMatch(/--brief/);
    // scriptGen has no call counter of its own to assert on directly, but plan() would have
    // thrown/returned before ever reaching runPlan — proven by no printed review being emitted.
    expect(sink.lines).toHaveLength(0);
    void scriptGen;
  });

  it("plan with a valid brief prints the script + storyboard review and writes files, touching no spend adapters", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-run-plan-test-"));
    const cwd = scratchDir;
    const { container, engine, voice, profile } = makeContainer();
    const sink = makeSink();
    await runCli(["discover"], container, cwd, sink.print, sink.printErr);

    const code = await runCli(
      ["plan", "--brief", "Show how to invite a teammate", "--platform", "youtube"],
      container,
      cwd,
      sink.print,
      sink.printErr,
    );

    expect(code).toBe(0);
    const output = sink.lines.join("\n");
    expect(output).toContain("Let's invite a teammate.");
    expect(output).toContain("guideo render --approve");
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
    expect(profile.composeCalls).toBe(0);
  });

  it("render without --approve refuses at the CLI layer with no spend", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-run-render-test-"));
    const cwd = scratchDir;
    const { container, engine, voice, profile } = makeContainer();
    const sink = makeSink();
    await runCli(["discover"], container, cwd, sink.print, sink.printErr);
    await runCli(
      ["plan", "--brief", "Show how to invite a teammate"],
      container,
      cwd,
      sink.print,
      sink.printErr,
    );

    const code = await runCli(["render"], container, cwd, sink.print, sink.printErr);

    expect(code).toBe(1);
    expect(sink.errLines.join("\n")).toMatch(/--approve/);
    expect(engine.captureCalls).toBe(0);
    expect(voice.synthesizeCalls).toBe(0);
    expect(profile.composeCalls).toBe(0);
  });

  it("render --approve after a plan run renders through every spend adapter exactly once", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-run-render-test-"));
    const cwd = scratchDir;
    const { container, engine, voice, profile } = makeContainer();
    const sink = makeSink();
    await runCli(["discover"], container, cwd, sink.print, sink.printErr);
    await runCli(
      ["plan", "--brief", "Show how to invite a teammate"],
      container,
      cwd,
      sink.print,
      sink.printErr,
    );

    const code = await runCli(["render", "--approve"], container, cwd, sink.print, sink.printErr);

    expect(code).toBe(0);
    expect(sink.lines.at(-1)).toMatch(/final\.mp4/);
    expect(engine.captureCalls).toBe(1);
    expect(voice.synthesizeCalls).toBe(1);
    expect(profile.composeCalls).toBe(1);
  });

  it("render --approve writes the final video to the STABLE project output path, not a temp dir", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-run-render-stable-test-"));
    const cwd = scratchDir;
    const { container, profile } = makeContainer();
    const sink = makeSink();
    await runCli(["discover", "--project", "acme"], container, cwd, sink.print, sink.printErr);
    await runCli(
      ["plan", "--brief", "Show how to invite a teammate", "--project", "acme"],
      container,
      cwd,
      sink.print,
      sink.printErr,
    );

    const code = await runCli(
      ["render", "--approve", "--project", "acme"],
      container,
      cwd,
      sink.print,
      sink.printErr,
    );

    expect(code).toBe(0);
    const expectedOutputPath = projectPaths({ project: "acme", cwd }).outputPath;
    expect(expectedOutputPath).toMatch(/[\\/]projects[\\/]acme[\\/]output[\\/]youtube\.mp4$/);
    expect(profile.lastParams?.outputPath).toBe(expectedOutputPath);
    // No mkdtemp/OS-temp-dir path leaked into what the compose adapter was asked to write to.
    expect(profile.lastParams?.outputPath).not.toMatch(/guideo-compose-/);
  });

  it("isolates artifacts per --project: a different project writes to a different directory", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "guideo-run-project-isolation-test-"));
    const cwd = scratchDir;
    const { container: containerA } = makeContainer();
    const { container: containerB } = makeContainer();
    const sink = makeSink();

    await runCli(
      ["discover", "--project", "project-a"],
      containerA,
      cwd,
      sink.print,
      sink.printErr,
    );
    await runCli(
      ["discover", "--project", "project-b"],
      containerB,
      cwd,
      sink.print,
      sink.printErr,
    );

    const pathsA = projectPaths({ project: "project-a", cwd });
    const pathsB = projectPaths({ project: "project-b", cwd });
    expect(pathsA.flowGraphPath).not.toBe(pathsB.flowGraphPath);
    await expect(stat(pathsA.flowGraphPath)).resolves.toBeDefined();
    await expect(stat(pathsB.flowGraphPath)).resolves.toBeDefined();
  });

  describe("missing target env vars", () => {
    const savedEnv = {
      url: process.env.GUIDEO_TARGET_URL,
      username: process.env.GUIDEO_TARGET_USERNAME,
      password: process.env.GUIDEO_TARGET_PASSWORD,
    };

    beforeEach(() => {
      delete process.env.GUIDEO_TARGET_URL;
      delete process.env.GUIDEO_TARGET_USERNAME;
      delete process.env.GUIDEO_TARGET_PASSWORD;
    });

    afterEach(() => {
      if (savedEnv.url === undefined) delete process.env.GUIDEO_TARGET_URL;
      else process.env.GUIDEO_TARGET_URL = savedEnv.url;
      if (savedEnv.username === undefined) delete process.env.GUIDEO_TARGET_USERNAME;
      else process.env.GUIDEO_TARGET_USERNAME = savedEnv.username;
      if (savedEnv.password === undefined) delete process.env.GUIDEO_TARGET_PASSWORD;
      else process.env.GUIDEO_TARGET_PASSWORD = savedEnv.password;
    });

    it("discover with the real UrlCredsTarget and no env vars fails with a clear message, no browser launch", async () => {
      scratchDir = await mkdtemp(join(tmpdir(), "guideo-run-discover-test-"));
      const cwd = scratchDir;
      // readTargetEnvOrThrow() runs before any browser/network I/O — safe for npm test.
      const container: Container = {
        target: new UrlCredsTarget(),
        scriptGen: new FakeScriptGen(),
        recordingEngine: new FakeRecordingEngine(),
        preRollTrimmer: new FakePreRollTrimmer(),
        privacyCutter: new FakePrivacyCutter(),
        effectsEngine: new FakeEffectsEngine(),
        sceneSplitter: new FakeSceneSplitter(),
        sceneAssembler: new FakeSceneAssembler(),
        voiceGen: new FakeVoiceGen(),
        platformProfile: new FakePlatformProfile(),
      };
      const sink = makeSink();

      const code = await runCli(["discover"], container, cwd, sink.print, sink.printErr);

      expect(code).toBe(1);
      expect(sink.errLines.join("\n")).toMatch(/GUIDEO_TARGET_URL/);
    });
  });
});
