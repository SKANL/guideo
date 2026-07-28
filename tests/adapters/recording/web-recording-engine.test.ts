import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeededRandom } from "../../../src/adapters/recording/seeded-random.js";
import type {
  CaptureBrowserLauncher,
  PatchrightCaptureBrowser,
  PatchrightCaptureElementHandle,
  PatchrightCapturePage,
} from "../../../src/adapters/recording/web-recording-engine.js";
import { WebRecordingEngine } from "../../../src/adapters/recording/web-recording-engine.js";
import { DEFAULT_LOGIN_CONFIG } from "../../../src/adapters/target/login.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { review } from "../../../src/domain/review-gate.js";

const LOGIN_URL = "https://target.example.com/login";
const LOGGED_IN_URL = "https://target.example.com/home";
// Short timeouts so the login-failure RED path doesn't slow the suite down.
const FAST_LOGIN_WAIT = { loginTimeoutMs: 30, loginPollIntervalMs: 5 };

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
// The fake page also tracks a mutable URL so the shared login() (see login.ts) can drive it: goto
// sets the current URL, and submitting login transitions off it (unless `staysOnLogin`, which
// simulates a stuck/failed login for the login-failure test).
function fakeCaptureHarness(options: { staysOnLogin?: boolean } = {}) {
  const log: string[] = [];
  let currentUrl = "";
  const goto = vi.fn(async (url: string) => {
    currentUrl = url;
    log.push(`goto:${url}`);
  });
  const fill = vi.fn(async (selector: string) => {
    log.push(`fill:${selector}`);
  });
  const click = vi.fn(async (selector: string) => {
    log.push(`click:${selector}`);
    if (selector === DEFAULT_LOGIN_CONFIG.submitSelector && !options.staysOnLogin) {
      currentUrl = LOGGED_IN_URL;
    }
  });
  const hover = vi.fn(async (selector: string) => {
    log.push(`hover:${selector}`);
  });
  const waitForSelector = vi.fn(async () => {
    log.push("waitForSelector");
  });
  const move = vi.fn(async (x: number, y: number) => {
    log.push(`move:${x},${y}`);
  });
  const type = vi.fn(async (text: string) => {
    log.push(`type:${text}`);
  });
  const press = vi.fn(async (key: string) => {
    log.push(`press:${key}`);
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
    fill,
    click,
    hover,
    waitForSelector,
    goBack: vi.fn(async () => {}),
    url: () => currentUrl,
    title: async () => "",
    $$: async () => [],
    $,
    mouse: { move },
    keyboard: { type, press },
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
    fill,
    click,
    hover,
    waitForSelector,
    move,
    type,
    press,
    waitForTimeout,
    $,
    newContext,
    contextClose,
    browserClose,
  };
}

describe("WebRecordingEngine", () => {
  const originalEnv = {
    url: process.env.GUIDEO_TARGET_URL,
    username: process.env.GUIDEO_TARGET_USERNAME,
    password: process.env.GUIDEO_TARGET_PASSWORD,
  };

  beforeEach(() => {
    process.env.GUIDEO_TARGET_URL = LOGIN_URL;
    process.env.GUIDEO_TARGET_USERNAME = "alice";
    process.env.GUIDEO_TARGET_PASSWORD = "s3cret";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({
      GUIDEO_TARGET_URL: originalEnv.url,
      GUIDEO_TARGET_USERNAME: originalEnv.username,
      GUIDEO_TARGET_PASSWORD: originalEnv.password,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reads the navigate URL from params.route when params.url is absent (LLM key variance)", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "navigate",
          params: { route: "https://example.com/agency" },
          narrationSegmentId: "seg-1",
        },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1));
    await engine.capture(approved);

    expect(harness.goto).toHaveBeenCalledWith("https://example.com/agency", {
      waitUntil: "networkidle",
    });
  });

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

    // navigate — waits for the configured settle state, not left to the default
    expect(harness.goto).toHaveBeenCalledWith("https://example.com/dashboard", {
      waitUntil: "networkidle",
    });
    // click — targets the :visible match (multiple DOM matches can exist for one selector)
    expect(harness.click).toHaveBeenCalledWith("#login-btn:visible");
    // type: per-char keyboard input, not a single whole-string call
    expect(harness.type).toHaveBeenCalledTimes(2);
    expect(harness.type).toHaveBeenNthCalledWith(1, "h");
    expect(harness.type).toHaveBeenNthCalledWith(2, "i");
    // hover — same :visible targeting as click
    expect(harness.hover).toHaveBeenCalledWith("#menu:visible");

    // mouse: multiple eased move() calls across click/type/hover/zoom targets — not a teleport
    expect(harness.move.mock.calls.length).toBeGreaterThan(20);

    // a pacing delay precedes every individual keystroke (jittered typing, not instant)
    const typeIndex = harness.log.indexOf("type:h");
    expect(harness.log[typeIndex - 1]).toMatch(/^wait:/);
    const secondTypeIndex = harness.log.indexOf("type:i");
    expect(harness.log[secondTypeIndex - 1]).toMatch(/^wait:/);

    // action order preserved: navigate before click before type before hover
    expect(harness.log.indexOf("goto:https://example.com/dashboard")).toBeLessThan(
      harness.log.indexOf("click:#login-btn:visible"),
    );
    expect(harness.log.indexOf("click:#login-btn:visible")).toBeLessThan(
      harness.log.indexOf("type:h"),
    );
    expect(harness.log.indexOf("type:i")).toBeLessThan(harness.log.indexOf("hover:#menu:visible"));

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

  // --- Authenticate before capture (reuses discovery's shared login.ts) --------------------

  it("logs in the same way discovery does before running any storyboard step", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "click",
          selector: 'role=link[name="Manifestaciones"]',
          narrationSegmentId: "seg-1",
        },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1));
    await engine.capture(approved);

    // Login sequence: goto(login url) -> waitForSelector(password) -> fill username -> fill
    // password -> click submit — all BEFORE the first storyboard step's click.
    const gotoIndex = harness.log.indexOf(`goto:${LOGIN_URL}`);
    const waitIndex = harness.log.indexOf("waitForSelector");
    const fillUsernameIndex = harness.log.indexOf(`fill:${DEFAULT_LOGIN_CONFIG.usernameSelector}`);
    const fillPasswordIndex = harness.log.indexOf(`fill:${DEFAULT_LOGIN_CONFIG.passwordSelector}`);
    const submitIndex = harness.log.indexOf(`click:${DEFAULT_LOGIN_CONFIG.submitSelector}`);
    const storyboardClickIndex = harness.log.indexOf(
      'click:role=link[name="Manifestaciones"]:visible',
    );

    expect(gotoIndex).toBeGreaterThanOrEqual(0);
    expect(waitIndex).toBeGreaterThan(gotoIndex);
    expect(fillUsernameIndex).toBeGreaterThan(waitIndex);
    expect(fillPasswordIndex).toBeGreaterThan(fillUsernameIndex);
    expect(submitIndex).toBeGreaterThan(fillPasswordIndex);
    expect(storyboardClickIndex).toBeGreaterThan(submitIndex);
  });

  it("throws the clear login error and never runs the storyboard when login is stuck/failed", async () => {
    const harness = fakeCaptureHarness({ staysOnLogin: true });
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "click",
          selector: 'role=link[name="Manifestaciones"]',
          narrationSegmentId: "seg-1",
        },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(
      harness.launcher,
      new SeededRandom(1),
      {},
      {},
      FAST_LOGIN_WAIT,
    );

    await expect(engine.capture(approved)).rejects.toThrow(/Login failed/);
    expect(harness.click).not.toHaveBeenCalledWith('role=link[name="Manifestaciones"]:visible');
    expect(harness.browserClose).toHaveBeenCalled();
  });

  // --- Dismiss blocking onboarding overlays (real e2e finding) ------------------------------

  it("presses the dismiss key after login and after each navigate step, before any click", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "navigate",
          params: { url: "https://example.com/dashboard" },
          narrationSegmentId: "seg-1",
        },
        { action: "click", selector: "#nav-link", narrationSegmentId: "seg-1" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1));
    await engine.capture(approved);

    expect(harness.press).toHaveBeenCalledWith("Escape");
    // 2 presses after login + 2 after the single navigate step (default dismissPresses: 2).
    expect(harness.press.mock.calls.length).toBe(4);

    const submitIndex = harness.log.indexOf(`click:${DEFAULT_LOGIN_CONFIG.submitSelector}`);
    const gotoIndex = harness.log.indexOf("goto:https://example.com/dashboard");
    const clickIndex = harness.log.indexOf("click:#nav-link:visible");
    const firstPressIndex = harness.log.indexOf("press:Escape");
    const pressAfterNavIndex = harness.log.indexOf("press:Escape", gotoIndex + 1);

    // dismissed once right after login, before the first storyboard step (navigate)...
    expect(firstPressIndex).toBeGreaterThan(submitIndex);
    expect(firstPressIndex).toBeLessThan(gotoIndex);
    // ...and again right after navigate, before the click.
    expect(pressAfterNavIndex).toBeGreaterThan(gotoIndex);
    expect(pressAfterNavIndex).toBeLessThan(clickIndex);
  });

  it("does not press the dismiss key when dismissOverlays is disabled", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "#a", narrationSegmentId: "seg-1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1), undefined, {
      dismissOverlays: false,
    });
    await engine.capture(approved);

    expect(harness.press).not.toHaveBeenCalled();
  });

  it("navigates with the configured waitUntil option", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        {
          action: "navigate",
          params: { url: "https://example.com/x" },
          narrationSegmentId: "seg-1",
        },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1), undefined, {
      navigateWaitUntil: "load",
    });
    await engine.capture(approved);

    expect(harness.goto).toHaveBeenCalledWith("https://example.com/x", { waitUntil: "load" });
  });

  // --- Narration-driven timing (voice-first pacing) ----------------------------------------

  it("paces each scene's total elapsed time to its narration segment's target duration", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        { action: "pause", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    // dismissOverlays disabled so every waitForTimeout call is attributable to a scene (no login/
    // overlay-dismissal waits mixed into the sequence).
    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1), undefined, {
      dismissOverlays: false,
    });
    const segmentDurationsMs = new Map([
      ["seg-1", 3000],
      ["seg-2", 5000],
    ]);

    await engine.capture(approved, segmentDurationsMs);

    const waits = harness.waitForTimeout.mock.calls.map(([ms]) => ms as number);
    // Each "pause" step contributes exactly 2 human-feel waits (the pre-step pacing wait + the
    // pause action's own extra wait) before a scene-padding wait tops the scene up to its target.
    const scene1Actions = (waits[0] ?? 0) + (waits[1] ?? 0);
    const scene1Total = scene1Actions + (waits[2] ?? 0);
    const scene2Actions = (waits[3] ?? 0) + (waits[4] ?? 0);
    const scene2Total = scene2Actions + (waits[5] ?? 0);

    // Never trimmed below what the actions themselves took.
    expect(scene1Total).toBeGreaterThanOrEqual(scene1Actions);
    expect(scene2Total).toBeGreaterThanOrEqual(scene2Actions);
    // Paced to within the default timing slack of the narration target.
    expect(Math.abs(scene1Total - 3000)).toBeLessThanOrEqual(250);
    expect(Math.abs(scene2Total - 5000)).toBeLessThanOrEqual(250);
  });

  it("runs a scene whose segment has no target duration without crashing (falls back to human-feel pacing)", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-unknown" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1));
    const clip = await engine.capture(approved, new Map([["seg-other", 9999]]));

    expect(clip.durationMs).toBeGreaterThan(0);
  });

  // --- Per-scene time ranges (design section B — effects/edit stage needs this) ------------

  it("returns contiguous, correctly-ordered scene ranges matching each scene's paced duration", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        { action: "pause", narrationSegmentId: "seg-1" },
        { action: "pause", narrationSegmentId: "seg-2" },
        { action: "pause", narrationSegmentId: "seg-3" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    // dismissOverlays disabled so every scene's paced duration is attributable purely to
    // human-feel/pacing waits, not overlay-dismissal noise.
    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1), undefined, {
      dismissOverlays: false,
    });
    const segmentDurationsMs = new Map([
      ["seg-1", 3000],
      ["seg-2", 5000],
      ["seg-3", 2000],
    ]);

    const clip = await engine.capture(approved, segmentDurationsMs);

    expect(clip.scenes).toHaveLength(3);
    const [scene1, scene2, scene3] = clip.scenes;
    if (!scene1 || !scene2 || !scene3) throw new Error("expected 3 scenes");

    // Ordered and matching the storyboard's narrationSegmentIds.
    expect(scene1.narrationSegmentId).toBe("seg-1");
    expect(scene2.narrationSegmentId).toBe("seg-2");
    expect(scene3.narrationSegmentId).toBe("seg-3");

    // Contiguous: each scene's endMs is exactly the next scene's startMs. First scene starts
    // at the offset accrued before scene 0 (here 0, since login/overlay-dismiss both produce no
    // tracked wait time in this harness/config).
    expect(scene1.startMs).toBe(0);
    expect(scene2.startMs).toBe(scene1.endMs);
    expect(scene3.startMs).toBe(scene2.endMs);

    // Each scene's own duration is paced to within the default timing slack of its target.
    expect(Math.abs(scene1.endMs - scene1.startMs - 3000)).toBeLessThanOrEqual(250);
    expect(Math.abs(scene2.endMs - scene2.startMs - 5000)).toBeLessThanOrEqual(250);
    expect(Math.abs(scene3.endMs - scene3.startMs - 2000)).toBeLessThanOrEqual(250);
  });

  it("keeps scene 0 at startMs 0 regardless of login/overlay-dismiss time (privacy/alignment fix: scenes are 0-based)", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    // dismissOverlays enabled (default: 2 presses * 300ms = 600ms) happens once after login,
    // before scene 0 starts — but that time must NOT offset scene 0 anymore (see preRollMs test
    // below for where it's tracked instead).
    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1));
    const clip = await engine.capture(approved, new Map([["seg-1", 3000]]));

    expect(clip.scenes[0]?.startMs).toBe(0);
  });

  // --- Real wall-clock pre-roll (design section C — privacy: trim login/overlay-dismiss before
  // the shown output; the alignment bug: scenes must be 0-based, and the login footage's REAL
  // duration must be tracked separately so the trim step can cut exactly that much). -----------

  it("measures preRollMs as the injected clock's delta from recording start to the first scene's first action", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    // Deterministic fake clock: first call happens right after recording starts (context
    // creation), second call right before scene 0's first action (after login + dismiss).
    const clockValues = [1_000, 1_600];
    let clockCalls = 0;
    const now = () => clockValues[clockCalls++] ?? clockValues.at(-1) ?? 0;

    const engine = new WebRecordingEngine(
      harness.launcher,
      new SeededRandom(1),
      undefined,
      undefined,
      undefined,
      now,
    );
    const clip = await engine.capture(approved, new Map([["seg-1", 3000]]));

    expect(clip.preRollMs).toBe(600);
    expect(clip.scenes[0]?.startMs).toBe(0);
  });

  it("defaults preRollMs to 0 when the clock reports no elapsed time before scene 0", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [{ action: "pause", narrationSegmentId: "seg-1" }],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const now = () => 5_000;
    const engine = new WebRecordingEngine(
      harness.launcher,
      new SeededRandom(1),
      undefined,
      undefined,
      undefined,
      now,
    );
    const clip = await engine.capture(approved, new Map([["seg-1", 3000]]));

    expect(clip.preRollMs).toBe(0);
  });

  it("resolves click/hover selectors to the :visible match when a selector could match multiple elements", async () => {
    const harness = fakeCaptureHarness();
    const storyboard = parseStoryboard({
      steps: [
        { action: "click", selector: 'a[href="/x"]', narrationSegmentId: "seg-1" },
        { action: "hover", selector: 'a[href="/y"]', narrationSegmentId: "seg-1" },
      ],
    });
    const approved = review(storyboard, { kind: "approved" });
    if (approved === null) throw new Error("expected approval to mint ApprovedStoryboard");

    const engine = new WebRecordingEngine(harness.launcher, new SeededRandom(1));
    await engine.capture(approved);

    expect(harness.click).toHaveBeenCalledWith('a[href="/x"]:visible');
    expect(harness.hover).toHaveBeenCalledWith('a[href="/y"]:visible');
  });
});
