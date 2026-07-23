// WebRecordingEngine — RecordingEngine adapter, human-feel Chromium capture via patchright.
// Launches a browser with video recording enabled on the context, drives every storyboard step
// through humanize.ts (eased mouse moves, jittered per-char typing, natural pauses between
// actions), then finalizes the recording and returns a RawClip.
//
// DI: the browser launcher and Random are both injected (constructor params), never
// imported/launched at module load or class-construction time — same lazy-launch pattern as
// UrlCredsTarget/ElevenLabsVoice. Unit tests pass a fake CaptureBrowserLauncher/PatchrightCapturePage
// and a SeededRandom — no real browser, deterministic output. Only when capture() actually runs and
// no launcher was injected does this adapter lazily launch a real Chromium instance.

import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "patchright";
import type { RawClip } from "../../domain/models/media.js";
import type { ApprovedStoryboard, StoryboardStep } from "../../domain/models/storyboard.js";
import type { Random } from "../../domain/ports/random.js";
import type { RecordingEngine } from "../../domain/ports/recording-engine.js";
import type { LoginConfig } from "../target/login.js";
import { DEFAULT_LOGIN_CONFIG, login, readTargetEnvOrThrow } from "../target/login.js";
import type { PatchrightElementHandle, PatchrightPage } from "../target/url-creds-target.js";
import { type CaptureConfig, DEFAULT_CAPTURE_CONFIG } from "./capture-config.js";
import { DEFAULT_HUMAN_FEEL_CONFIG, type HumanFeelConfig } from "./human-feel-config.js";
import { easedMousePath, naturalPauseMs, type Point, typingDelays } from "./humanize.js";
import { SeededRandom } from "./seeded-random.js";

// Extends the target adapter's narrow ElementHandle with boundingBox() — needed here to compute
// an eased-mouse-move target, not needed there. Reuses rather than diverges from the base shape.
export interface PatchrightCaptureElementHandle extends PatchrightElementHandle {
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
}

export interface PatchrightMouse {
  move(x: number, y: number): Promise<void>;
}

// Only per-character type() calls are used (never a whole-string call) — that per-keystroke
// granularity is what lets capture() insert a jittered delay before each character. press() is
// used only to dismiss blocking overlays (see dismissOverlays()), never for text entry.
export interface PatchrightKeyboard {
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
}

export interface PatchrightVideo {
  path(): Promise<string>;
}

// Extends the target adapter's narrow Page with the capture-only surface: element lookup with a
// bounding box, hover, mouse/keyboard, explicit pacing waits, and the recorded video handle.
export interface PatchrightCapturePage extends PatchrightPage {
  $(selector: string): Promise<PatchrightCaptureElementHandle | null>;
  hover(selector: string): Promise<void>;
  mouse: PatchrightMouse;
  keyboard: PatchrightKeyboard;
  waitForTimeout(ms: number): Promise<void>;
  video(): PatchrightVideo | null;
}

export interface PatchrightCaptureContext {
  newPage(): Promise<PatchrightCapturePage>;
  close(): Promise<void>;
}

export interface PatchrightCaptureBrowser {
  newContext(options: {
    recordVideo: { dir: string; size?: { width: number; height: number } };
  }): Promise<PatchrightCaptureContext>;
  close(): Promise<void>;
}

export type CaptureBrowserLauncher = () => Promise<PatchrightCaptureBrowser>;

function requireSelector(step: StoryboardStep): string {
  if (!step.selector) {
    throw new Error(`WebRecordingEngine: step action "${step.action}" requires a selector.`);
  }
  return step.selector;
}

// Real e2e finding: the same selector can match more than one DOM element (e.g. an `a[href]` in
// both a sidebar and a dashboard card) — only one is actually visible/clickable. Appending the
// `:visible` pseudo-class resolves click/hover targeting to the visible match instead of
// whichever one the engine happens to return first.
function visibleSelector(selector: string): string {
  return `${selector}:visible`;
}

export class WebRecordingEngine implements RecordingEngine {
  private readonly injectedLauncher: CaptureBrowserLauncher | undefined;
  private readonly random: Random;
  private readonly humanFeel: HumanFeelConfig;
  private readonly config: CaptureConfig;
  private readonly loginConfig: LoginConfig;

  constructor(
    launcher?: CaptureBrowserLauncher,
    random: Random = new SeededRandom(Date.now()),
    humanFeel: Partial<HumanFeelConfig> = {},
    config: Partial<CaptureConfig> = {},
    loginConfig: Partial<LoginConfig> = {},
  ) {
    this.injectedLauncher = launcher;
    this.random = random;
    this.humanFeel = { ...DEFAULT_HUMAN_FEEL_CONFIG, ...humanFeel };
    this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
    this.loginConfig = { ...DEFAULT_LOGIN_CONFIG, ...loginConfig };
  }

  async capture(storyboard: ApprovedStoryboard): Promise<RawClip> {
    const browser = await (this.injectedLauncher ?? (() => this.launchDefaultBrowser()))();

    try {
      const videoDir = await mkdtemp(join(this.config.videoDir, "guideo-capture-"));
      const context = await browser.newContext({
        recordVideo: { dir: videoDir, size: this.config.viewport },
      });

      const page = await context.newPage();
      // Authenticate the SAME way discovery does (shared login.ts — see its bug-fix history)
      // BEFORE running any storyboard step, so clicks on authenticated routes don't time out.
      const env = readTargetEnvOrThrow();
      await login(page, env, this.loginConfig);
      // Real e2e finding: an onboarding/welcome dialog covers the nav right after login and
      // intercepts every click's actionability check — clear it before driving any step.
      await this.dismissOverlays(page);

      let mousePosition = this.config.initialMousePosition;
      let elapsedMs = 0;

      for (const step of storyboard.steps) {
        const pauseMs = naturalPauseMs(this.random, this.humanFeel);
        await page.waitForTimeout(pauseMs);
        elapsedMs += pauseMs;

        const result = await this.runStep(page, step, mousePosition);
        mousePosition = result.mousePosition;
        elapsedMs += result.elapsedMs;

        // Same overlay can reappear (or a new one open) after a client-side route change.
        if (step.action === "navigate") await this.dismissOverlays(page);
      }

      const video = page.video();
      // Closing the context finalizes the video recording to disk (patchright/playwright only
      // flushes the file once the owning context closes).
      await context.close();
      const path = video ? await video.path() : join(videoDir, "capture.webm");

      return { path, durationMs: Math.round(elapsedMs), aspectRatio: "16:9" };
    } finally {
      await browser.close();
    }
  }

  private async runStep(
    page: PatchrightCapturePage,
    step: StoryboardStep,
    mousePosition: Point,
  ): Promise<{ mousePosition: Point; elapsedMs: number }> {
    switch (step.action) {
      case "navigate": {
        await page.goto(String(step.params?.url ?? ""), {
          waitUntil: this.config.navigateWaitUntil,
        });
        return { mousePosition, elapsedMs: 0 };
      }
      case "click": {
        const target = await this.resolveCenter(page, step);
        const moveMs = await this.moveMouse(page, mousePosition, target);
        await page.click(visibleSelector(requireSelector(step)));
        return { mousePosition: target, elapsedMs: moveMs };
      }
      case "hover": {
        const target = await this.resolveCenter(page, step);
        const moveMs = await this.moveMouse(page, mousePosition, target);
        await page.hover(visibleSelector(requireSelector(step)));
        return { mousePosition: target, elapsedMs: moveMs };
      }
      case "zoom": {
        // ponytail: no real pinch-zoom gesture is simulated — an eased move onto the element
        // stands in for "zoom" this slice. A real zoom/pinch gesture is a later upgrade.
        const target = await this.resolveCenter(page, step);
        const moveMs = await this.moveMouse(page, mousePosition, target);
        return { mousePosition: target, elapsedMs: moveMs };
      }
      case "type": {
        const target = await this.resolveCenter(page, step);
        const moveMs = await this.moveMouse(page, mousePosition, target);
        await page.click(visibleSelector(requireSelector(step)));
        const typeMs = await this.typeText(page, String(step.params?.text ?? ""));
        return { mousePosition: target, elapsedMs: moveMs + typeMs };
      }
      case "pause": {
        const extraMs = naturalPauseMs(this.random, this.humanFeel);
        await page.waitForTimeout(extraMs);
        return { mousePosition, elapsedMs: extraMs };
      }
      default: {
        return { mousePosition, elapsedMs: 0 };
      }
    }
  }

  private async resolveCenter(page: PatchrightCapturePage, step: StoryboardStep): Promise<Point> {
    const selector = visibleSelector(requireSelector(step));
    const handle = await page.$(selector);
    const box = await handle?.boundingBox();
    if (!box) {
      // ponytail: element not found/not visible — fall back to viewport center rather than
      // crashing capture; a missing element is a storyboard/target problem, not this adapter's.
      return { x: this.config.viewport.width / 2, y: this.config.viewport.height / 2 };
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  private async moveMouse(page: PatchrightCapturePage, from: Point, to: Point): Promise<number> {
    const path = easedMousePath(this.random, from, to, this.humanFeel);
    let elapsed = 0;
    for (const { point, delayMs } of path) {
      await page.waitForTimeout(delayMs);
      await page.mouse.move(point.x, point.y);
      elapsed += delayMs;
    }
    return elapsed;
  }

  // Presses `dismissKey` `dismissPresses` times, with a `dismissWaitMs` pause between presses, to
  // clear an onboarding/welcome overlay that would otherwise intercept every subsequent click. A
  // no-op when `dismissOverlays` is disabled.
  private async dismissOverlays(page: PatchrightCapturePage): Promise<void> {
    if (!this.config.dismissOverlays) return;
    for (let i = 0; i < this.config.dismissPresses; i++) {
      await page.keyboard.press(this.config.dismissKey);
      await page.waitForTimeout(this.config.dismissWaitMs);
    }
  }

  private async typeText(page: PatchrightCapturePage, text: string): Promise<number> {
    const delays = typingDelays(this.random, text.length, this.humanFeel);
    let elapsed = 0;
    for (let i = 0; i < text.length; i++) {
      const delay = delays[i] ?? 0;
      await page.waitForTimeout(delay);
      await page.keyboard.type(text[i] ?? "");
      elapsed += delay;
    }
    return elapsed;
  }

  // Lazy: only launches a real browser the first time capture() actually needs one and none was
  // injected. Never runs at import or construction time.
  private async launchDefaultBrowser(): Promise<PatchrightCaptureBrowser> {
    return chromium.launch({ headless: true });
  }
}
