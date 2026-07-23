import { describe, expect, it, vi } from "vitest";
import { SeededRandom } from "../../../src/adapters/recording/seeded-random.js";
import type {
  CaptureBrowserLauncher,
  PatchrightCaptureBrowser,
  PatchrightCaptureElementHandle,
  PatchrightCapturePage,
} from "../../../src/adapters/recording/web-recording-engine.js";
import { WebRecordingEngine } from "../../../src/adapters/recording/web-recording-engine.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { review } from "../../../src/domain/review-gate.js";

function fakeElement(box: { x: number; y: number; width: number; height: number }) {
  return {
    getAttribute: async () => null,
    textContent: async () => null,
    boundingBox: async () => box,
  } satisfies PatchrightCaptureElementHandle;
}

// Builds a fully mocked patchright capture harness (browser -> context -> page). Every call is
// logged into a shared, ordered `log` array so tests can assert both call counts AND ordering
// (e.g. a pacing delay precedes each individual mouse move / keystroke) without a real browser.
function fakeCaptureHarness() {
  const log: string[] = [];
  const goto = vi.fn(async (url: string) => {
    log.push(`goto:${url}`);
  });
  const click = vi.fn(async (selector: string) => {
    log.push(`click:${selector}`);
  });
  const hover = vi.fn(async (selector: string) => {
    log.push(`hover:${selector}`);
  });
  const move = vi.fn(async (x: number, y: number) => {
    log.push(`move:${x},${y}`);
  });
  const type = vi.fn(async (text: string) => {
    log.push(`type:${text}`);
  });
  const waitForTimeout = vi.fn(async (ms: number) => {
    log.push(`wait:${ms}`);
  });
  const $ = vi.fn(async (_selector: string) =>
    fakeElement({ x: 100, y: 100, width: 50, height: 20 }),
  );
  const closePage = vi.fn(async () => {});

  const page: PatchrightCapturePage = {
    goto,
    fill: vi.fn(async () => {}),
    click,
    hover,
    waitForSelector: vi.fn(async () => {}),
    goBack: vi.fn(async () => {}),
    url: () => "",
    title: async () => "",
    $$: async () => [],
    $,
    mouse: { move },
    keyboard: { type },
    waitForTimeout,
    video: () => ({ path: async () => "/tmp/guideo-capture/video.webm" }),
    close: closePage,
  };

  const contextClose = vi.fn(async () => {});
  const context = {
    newPage: async () => page,
    close: contextClose,
  };
  const newContext = vi.fn(async () => context);
  const browserClose = vi.fn(async () => {});
  const browser: PatchrightCaptureBrowser = {
    newContext,
    close: browserClose,
  };
  const launcher: CaptureBrowserLauncher = vi.fn(async () => browser);

  return {
    log,
    launcher,
    goto,
    click,
    hover,
    move,
    type,
    waitForTimeout,
    $,
    newContext,
    contextClose,
    browserClose,
  };
}

describe("WebRecordingEngine", () => {
  it("drives every storyboard action type in order through humanized mouse/keyboard and returns a RawClip", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "navigate",
          params: { url: "https://example.com/dashboard" },
          narrationSegmentId: "seg-1",
        },
        { action: "click", selector: "#login-btn", narrationSegmentId: "seg-1" },
        {
          action: "type",
          selector: "#search",
          params: { text: "hi" },
          narrationSegmentId: "seg-1",
        },
        { action: "hover", selector: "#menu", narrationSegmentId: "seg-1" },
        { action: "zoom", selector: "#chart", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-1" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(42));
    const clip = await engine.capture(approved);

    // navigate
    expect(harness.goto).toHaveBeenCalledWith("https://example.com/dashboard");
    // click
    expect(harness.click).toHaveBeenCalledWith("#login-btn");
    // type: per-char keyboard input, not a single whole-string call
    expect(harness.type).toHaveBeenCalledTimes(2);
    expect(harness.type).toHaveBeenNthCalledWith(1, "h");
    expect(harness.type).toHaveBeenNthCalledWith(2, "i");
    // hover
    expect(harness.hover).toHaveBeenCalledWith("#menu");

    // mouse: multiple eased move() calls across click/type/hover/zoom targets — not a teleport
    expect(harness.move.mock.calls.length).toBeGreaterThan(20);

    // a pacing delay precedes every individual keystroke (jittered typing, not instant)
    const typeIndex = harness.log.indexOf("type:h");
    expect(harness.log[typeIndex - 1]).toMatch(/^wait:/);
    const secondTypeIndex = harness.log.indexOf("type:i");
    expect(harness.log[secondTypeIndex - 1]).toMatch(/^wait:/);

    // action order preserved: navigate before click before type before hover
    expect(harness.log.indexOf("goto:https://example.com/dashboard")).toBeLessThan(
      harness.log.indexOf("click:#login-btn"),
    );
    expect(harness.log.indexOf("click:#login-btn")).toBeLessThan(harness.log.indexOf("type:h"));
    expect(harness.log.indexOf("type:i")).toBeLessThan(harness.log.indexOf("hover:#menu"));

    // video recording enabled + finalized
    expect(harness.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        recordVideo: expect.objectContaining({ dir: expect.any(String) }),
      }),
    );
    expect(harness.contextClose).toHaveBeenCalled();

    // RawClip shape
    expect(clip.path).toBe("/tmp/guideo-capture/video.webm");
    expect(clip.aspectRatio).toBe("16:9");
    expect(typeof clip.durationMs).toBe("number");
    expect(clip.durationMs).toBeGreaterThan(0);
  });

  it("is deterministic under a fixed seed: same seed produces the same mouse-move point sequence", async () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#a", narrationSegmentId: "seg-1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const harnessA = fakeCaptureHarness();
    const harnessB = fakeCaptureHarness();
    await new WebRecordingEngine(harnessA.launcher, new SeededRandom(7)).capture(approved);
    await new WebRecordingEngine(harnessB.launcher, new SeededRandom(7)).capture(approved);

    expect(harnessA.move.mock.calls).toEqual(harnessB.move.mock.calls);
  });

  it("closes the browser even if a step fails", async () => {
    const harness = fakeCaptureHarness();
    harness.goto.mockRejectedValueOnce(new Error("boom"));
    const storyboard = parseStoryboard({
      steps: [
        { action: "navigate", params: { url: "https://x.test" }, narrationSegmentId: "seg-1" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1));
    await expect(engine.capture(approved)).rejects.toThrow("boom");
    expect(harness.browserClose).toHaveBeenCalled();
  });
});
