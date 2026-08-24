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

import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "patchright";
import type { Effect } from "../../domain/models/effect.js";
import type {
  CaptureCheckpoint,
  CaptureEvidence,
  CaptureTrace,
  EffectRegion,
  RawClip,
  ResolvedEffect,
  SceneRange,
} from "../../domain/models/media.js";
import type { ApprovedStoryboard, StoryboardStep } from "../../domain/models/storyboard.js";
import type { Random } from "../../domain/ports/random.js";
import type { RecordingEngine } from "../../domain/ports/recording-engine.js";
import type { CaptureCheckpointStore } from "../../domain/ports/recording-engine.js";
import { sha256 } from "../../domain/artifacts/canonical.js";
import {
  LocatorResolutionError,
  orderedLocatorCandidates,
  resolveExactlyOne,
} from "../../domain/models/locator-resolution.js";
import { regionFromParams } from "../effects/effect-filter-builders.js";
import type { LoginConfig } from "../target/login.js";
import {
  DEFAULT_LOGIN_CONFIG,
  isExecutionContextDestroyedError,
  login,
  readTargetEnvOrThrow,
  resolveLoginConfig,
} from "../target/login.js";
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
  $$(selector: string): Promise<PatchrightCaptureElementHandle[]>;
  hover(selector: string): Promise<void>;
  mouse: PatchrightMouse;
  keyboard: PatchrightKeyboard;
  waitForTimeout(ms: number): Promise<void>;
  video(): PatchrightVideo | null;
  screenshot?(): Promise<unknown>;
}

export interface CaptureQuarantine {
  quarantine(runId: string, reason: string): Promise<void>;
}

export class CaptureRecoveryError extends Error {
  constructor(readonly diagnostic: {
    readonly kind: "stale-fingerprint" | "postcondition";
    readonly phase: "precondition" | "postcondition";
    readonly stepIndex: number;
    readonly expected: string;
    readonly actual: string;
  }) {
    super(`capture ${diagnostic.phase} ${diagnostic.kind} at step ${diagnostic.stepIndex}`);
    this.name = "CaptureRecoveryError";
  }
}

export interface PatchrightCaptureContext {
  newPage(): Promise<PatchrightCapturePage>;
  close(): Promise<void>;
}

export interface PatchrightCaptureBrowser {
  newContext(options: {
    recordVideo: { dir: string; size?: { width: number; height: number } };
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
  }): Promise<PatchrightCaptureContext>;
  close(): Promise<void>;
}

export type CaptureBrowserLauncher = () => Promise<PatchrightCaptureBrowser>;

// A "scene" is a consecutive run of storyboard steps sharing one narrationSegmentId — the unit
// narration-driven timing paces to. Grouped by adjacency only (no reordering): a storyboard is
// LLM-authored and already emits steps for one narration beat together.
interface CaptureScene {
  readonly narrationSegmentId: string;
  readonly steps: readonly StoryboardStep[];
}

function groupIntoScenes(steps: readonly StoryboardStep[]): CaptureScene[] {
  const scenes: { narrationSegmentId: string; steps: StoryboardStep[] }[] = [];
  for (const step of steps) {
    const last = scenes[scenes.length - 1];
    if (last && last.narrationSegmentId === step.narrationSegmentId) {
      last.steps.push(step);
    } else {
      scenes.push({ narrationSegmentId: step.narrationSegmentId, steps: [step] });
    }
  }
  return scenes;
}

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Matches an exact `a[href="..."]` selector — the ONLY selector shape whose target URL is
// staticaly recoverable without re-querying the (possibly gone) DOM, i.e. the shape
// buildRobustSelector's href fallback produces (see url-creds-target.ts). This is what lets a
// click self-heal fall back to a direct goto when the click itself didn't navigate.
const ANCHOR_HREF_SELECTOR_RE = /^a\[href="([^"]*)"\]$/;

// Resolves a model-authored navigate URL to an ABSOLUTE one. An already-absolute URL passes
// through unchanged; a relative path (e.g. "/agency/dashboard") resolves against the current
// (post-login) page URL. patchright's goto rejects a relative URL ("Cannot navigate to invalid
// URL"), and the LLM sometimes emits relative routes (real e2e). Falls back to the raw value when
// resolution isn't possible (empty input or no base), so navigateWithVerification surfaces a clear
// error instead of this throwing.
export function resolveNavigateUrl(raw: string, base: string): string {
  if (!raw) return raw;
  try {
    return new URL(raw, base || undefined).toString();
  } catch {
    return raw;
  }
}

export class WebRecordingEngine implements RecordingEngine {
  private readonly injectedLauncher: CaptureBrowserLauncher | undefined;
  private readonly random: Random;
  private readonly humanFeel: HumanFeelConfig;
  private readonly config: CaptureConfig;
  private readonly loginConfig: LoginConfig;

  private readonly now: () => number;
  private readonly quarantine: CaptureQuarantine | undefined;

  constructor(
    launcher?: CaptureBrowserLauncher,
    random: Random = new SeededRandom(Date.now()),
    humanFeel: Partial<HumanFeelConfig> = {},
    config: Partial<CaptureConfig> = {},
    loginConfig: Partial<LoginConfig> = {},
    now: () => number = () => Date.now(),
    quarantine?: CaptureQuarantine,
    private readonly checkpoints?: CaptureCheckpointStore,
  ) {
    this.injectedLauncher = launcher;
    this.random = random;
    this.humanFeel = { ...DEFAULT_HUMAN_FEEL_CONFIG, ...humanFeel };
    this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
    this.loginConfig = { ...DEFAULT_LOGIN_CONFIG, ...loginConfig };
    this.now = now;
    this.quarantine = quarantine;
  }

  async capture(
    storyboard: ApprovedStoryboard,
    segmentDurationsMs: ReadonlyMap<string, number> = new Map(),
  ): Promise<RawClip> {
    const runId = randomUUID();
    const inputSha256 = sha256({ storyboard, segmentDurationsMs: [...segmentDurationsMs.entries()] });
    const recovered = await this.checkpoints?.load(inputSha256);
    if (recovered?.finalized) return recovered.finalized;
    const browser = await (this.injectedLauncher ?? (() => this.launchDefaultBrowser()))();

    try {
      const videoDir = await mkdtemp(join(this.config.videoDir, "guideo-capture-"));
      const context = await browser.newContext({
        recordVideo: { dir: videoDir, size: this.config.viewport },
        viewport: this.config.viewport,
        deviceScaleFactor: this.config.deviceScaleFactor,
      });
      // patchright/playwright starts recording video the moment the context is created — the
      // real wall-clock time from here until scene 0's first action is genuine login/overlay-
      // dismiss footage at the front of the raw video. Measured via the injectable clock (not the
      // synthetic pacing sums below) so the pre-roll trim step can cut exactly that much.
      const recordingStartMs = this.now();

      const page = await context.newPage();
      // Authenticate the SAME way discovery does (shared login.ts — see its bug-fix history)
      // BEFORE running any storyboard step, so clicks on authenticated routes don't time out.
      const env = readTargetEnvOrThrow();
      await login(page, env, resolveLoginConfig(this.loginConfig));
      // Real e2e finding: an onboarding/welcome dialog covers the nav right after login and
      // intercepts every click's actionability check — clear it before driving any step.
      await this.dismissOverlays(page);
      const preRollMs = Math.max(0, Math.round(this.now() - recordingStartMs));

      // Scene ranges are 0-based relative to scene 0 (privacy/alignment fix — design doc section
      // C): the login/overlay-dismiss time above is tracked ONLY via preRollMs, never folded into
      // these ranges, so effects/subtitles/audio (keyed to scenes[*]) stay aligned once the
      // pre-roll trim step removes that footage.
      let elapsedMs = 0;

      let mousePosition = this.config.initialMousePosition;
      const scenes: SceneRange[] = [];
      // Effect targeting (effects-overhaul Phase A): resolved WHILE running each step, so the
      // target element is actually on screen — see resolveEffectRegion(). Accumulated in
      // storyboard order across scenes so its positional index lines up with
      // buildSceneEffectsGraph's own iteration (see effects-graph.ts).
      const resolvedEffects: ResolvedEffect[] = [];
      const traces: CaptureTrace[] = [];
      const screenshots: string[] = [];
      const checkpoints: CaptureCheckpoint[] = [];
      let resume: CaptureEvidence["resume"];
      let stepIndex = 0;

      for (const scene of groupIntoScenes(storyboard.steps)) {
        const startMs = Math.round(elapsedMs);
        const result = await this.runScene(
          page,
          scene,
          mousePosition,
          segmentDurationsMs.get(scene.narrationSegmentId),
          stepIndex,
          async (step) => {
            const currentIndex = stepIndex++;
            traces.push({ stepIndex: currentIndex, action: step.action, url: page.url() });
            const screenshot = await page.screenshot?.();
            if (typeof screenshot === "string" && screenshot) screenshots.push(screenshot);
            if (checkpoints.length < this.config.maxCheckpoints) {
              const checkpoint = { runId, inputSha256, completedStepIndex: currentIndex, url: page.url() };
              checkpoints.push(checkpoint);
              await this.checkpoints?.save(checkpoint);
              resume = { nextStepIndex: currentIndex + 1, url: page.url() };
            }
          },
        );
        mousePosition = result.mousePosition;
        elapsedMs += result.elapsedMs;
        resolvedEffects.push(...result.resolvedEffects);
        const endMs = Math.round(elapsedMs);
        scenes.push({ narrationSegmentId: scene.narrationSegmentId, startMs, endMs });
      }

      const video = page.video();
      // Closing the context finalizes the video recording to disk (patchright/playwright only
      // flushes the file once the owning context closes).
      await context.close();
      const path = video ? await video.path() : join(videoDir, "capture.webm");

      const clip: RawClip = {
        path,
        durationMs: Math.round(elapsedMs),
        aspectRatio: "16:9",
        scenes,
        preRollMs,
        resolvedEffects,
        captureEvidence: { traces, screenshots, checkpoints, ...(resume ? { resume } : {}) },
      };
      if (checkpoints.length === 0) await this.checkpoints?.save({ runId, inputSha256, completedStepIndex: -1, url: page.url() });
      await this.checkpoints?.finalize(inputSha256, clip);
      return clip;
    } catch (error) {
      if (error instanceof LocatorResolutionError || error instanceof CaptureRecoveryError) {
        await this.quarantine?.quarantine(runId, JSON.stringify(error.diagnostic));
      }
      throw error;
    } finally {
      await browser.close();
    }
  }

  // Runs one scene's steps with the existing human-feel pacing, then — if the narration segment
  // has a known target duration — pads the scene with one extra waitForTimeout so its total
  // elapsed time fills roughly that duration (never trims: only pads UP to the target, and never
  // below minSceneMs). No target known (targetMs undefined) => unchanged human-feel behavior.
  private async runScene(
    page: PatchrightCapturePage,
    scene: CaptureScene,
    mousePositionIn: Point,
    targetMs: number | undefined,
    startStepIndex: number,
    onStepCompleted: (step: StoryboardStep) => Promise<void>,
  ): Promise<{ mousePosition: Point; elapsedMs: number; resolvedEffects: ResolvedEffect[] }> {
    let mousePosition = mousePositionIn;
    let elapsedMs = 0;
    const resolvedEffects: ResolvedEffect[] = [];

    for (const [sceneStepIndex, step] of scene.steps.entries()) {
      const pauseMs = naturalPauseMs(this.random, this.humanFeel);
      await page.waitForTimeout(pauseMs);
      elapsedMs += pauseMs;

      const stepIndex = startStepIndex + sceneStepIndex;
      const preparedStep = await this.prepareRequiredStep(page, step, stepIndex);
      const preActionRegions = await Promise.all(
        preparedStep.effects.map((effect) => this.resolveEffectRegion(page, effect)),
      );
      const result = await this.runStep(page, preparedStep, mousePosition);
      this.verifyPostcondition(page, preparedStep, stepIndex);
      await onStepCompleted(preparedStep);
      mousePosition = result.mousePosition;
      elapsedMs += result.elapsedMs;

      // Resolved HERE (right after the step's own action settles) so any element the step just
      // navigated to / clicked / revealed is actually on screen for boundingBox() to find.
      for (const [effectIndex, effect] of step.effects.entries()) {
        // Prefer the pre-action box: click targets frequently disappear or change state after
        // the interaction (e.g. Add to cart becomes Remove), but the visual emphasis still needs
        // the location the user acted on.
        const region = preActionRegions[effectIndex] ?? null;
        resolvedEffects.push({
          narrationSegmentId: step.narrationSegmentId,
          type: effect.type,
          region,
        });
      }

      // Same overlay can reappear (or a new one open) after a client-side route change.
      if (step.action === "navigate") elapsedMs += await this.dismissOverlays(page);
    }

    if (targetMs !== undefined) {
      const effectiveTargetMs = Math.max(targetMs, this.config.minSceneMs);
      const shortfallMs = effectiveTargetMs - elapsedMs;
      if (shortfallMs > this.config.timingSlackMs) {
        await page.waitForTimeout(shortfallMs);
        elapsedMs += shortfallMs;
      }
    }

    return { mousePosition, elapsedMs, resolvedEffects };
  }

  private async prepareRequiredStep(
    page: PatchrightCapturePage,
    step: StoryboardStep,
    stepIndex: number,
  ): Promise<StoryboardStep> {
    const evidence = step.evidence;
    if (evidence?.urlFingerprint && evidence.urlFingerprint !== page.url()) {
      throw new CaptureRecoveryError({
        kind: "stale-fingerprint", phase: "precondition", stepIndex,
        expected: evidence.urlFingerprint, actual: page.url(),
      });
    }
    if (!step.selector || !evidence?.locatorCandidates?.length) return step;
    const candidates = orderedLocatorCandidates(evidence.locatorCandidates, step.selector);
    const matches = await Promise.all(candidates.map(async (selector) => ({
      selector,
      matches: await this.withStepRetry(() => page.$$(visibleSelector(selector)), page),
    })));
    const resolved = resolveExactlyOne(matches);
    return { ...step, selector: resolved.selector };
  }

  private verifyPostcondition(page: PatchrightCapturePage, step: StoryboardStep, stepIndex: number): void {
    const expected = step.evidence?.expectedPostState;
    if (expected && page.url() !== expected) {
      throw new CaptureRecoveryError({
        kind: "postcondition", phase: "postcondition", stepIndex, expected, actual: page.url(),
      });
    }
  }

  // Effect targeting (effects-overhaul Phase A): a `selector` in the effect's own params (NOT the
  // step's action selector — an effect may target a different element than the one the step just
  // acted on) is resolved to a pixel bounding box while the page is in the step's post-action
  // state. An explicit {x,y,w,h} in params passes through unchanged. Neither present, or the
  // selector resolves to no element -> null (caller/builder falls back to frame-center/whole-
  // frame) — never throws; a missing effect target is a storyboard/target problem, not a reason to
  // abort the whole capture.
  private async resolveEffectRegion(
    page: PatchrightCapturePage,
    effect: Effect,
  ): Promise<EffectRegion | null> {
    const selector = typeof effect.params.selector === "string" ? effect.params.selector : "";
    if (!selector) {
      return regionFromParams(effect.params);
    }
    let handle: PatchrightCaptureElementHandle | null = null;
    try {
      handle = await this.withStepRetry(() => page.$(visibleSelector(selector)), page);
    } catch (err) {
      console.warn(
        `WebRecordingEngine: giving up resolving effect target "${selector}" after retries — falling back. ${errorMessage(err)}`,
      );
    }
    const box = await handle?.boundingBox();
    if (!box) {
      console.warn(
        `WebRecordingEngine: effect selector "${selector}" resolved to no element — falling back.`,
      );
      return regionFromParams(effect.params);
    }
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }

  private async runStep(
    page: PatchrightCapturePage,
    step: StoryboardStep,
    mousePosition: Point,
  ): Promise<{ mousePosition: Point; elapsedMs: number }> {
    switch (step.action) {
      case "navigate": {
        // The storyboard's navigate URL is model-authored, and the LLM is inconsistent about the
        // param key (url / route / href) — read all common variants rather than fail on an empty
        // goto (real e2e: a plan run put it under `route`, not `url`).
        const raw = String(step.params?.url ?? step.params?.route ?? step.params?.href ?? "");
        // The LLM also sometimes emits a RELATIVE path (e.g. "/agency/dashboard") — patchright's
        // goto rejects a relative URL ("Cannot navigate to invalid URL"). Resolve it against the
        // current (post-login) page URL to an absolute URL before navigating (real e2e).
        const url = resolveNavigateUrl(raw, page.url());
        await this.navigateWithVerification(page, url);
        const settleMs = await this.settleContent(page);
        return { mousePosition, elapsedMs: settleMs };
      }
      case "click": {
        const target = await this.resolveCenter(page, step);
        const moveMs = await this.moveMouse(page, mousePosition, target);
        const beforeUrl = page.url();
        await this.performClick(page, requireSelector(step));
        // A nav click changed the page — wait for the destination content to paint before pacing.
        const settleMs = page.url() !== beforeUrl ? await this.settleContent(page) : 0;
        return { mousePosition: target, elapsedMs: moveMs + settleMs };
      }
      case "hover": {
        const target = await this.resolveCenter(page, step);
        const moveMs = await this.moveMouse(page, mousePosition, target);
        const selector = requireSelector(step);
        try {
          await this.withStepRetry(() => page.hover(visibleSelector(selector)), page);
        } catch (err) {
          console.warn(
            `WebRecordingEngine: giving up hovering "${selector}" after retries — skipping this step. ${errorMessage(err)}`,
          );
        }
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
        await this.performClick(page, requireSelector(step));
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
    let handle: PatchrightCaptureElementHandle | null = null;
    try {
      handle = await this.withStepRetry(() => page.$(selector), page);
    } catch (err) {
      console.warn(
        `WebRecordingEngine: giving up resolving "${selector}" after retries — falling back to viewport center. ${errorMessage(err)}`,
      );
    }
    const box = await handle?.boundingBox();
    if (!box) {
      // ponytail: element not found/not visible — fall back to viewport center rather than
      // crashing capture; a missing element is a storyboard/target problem, not this adapter's.
      return { x: this.config.viewport.width / 2, y: this.config.viewport.height / 2 };
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // Self-healing capture (design section E) — bounded retry against the SAME "Execution context
  // was destroyed" navigation race discovery hardens against (see login.ts's shared
  // isExecutionContextDestroyedError). Capture clicks nav links constantly, so a page query/
  // click/hover run right after a navigate step can race a late SPA redirect. Any OTHER error is
  // not this race and propagates immediately, unretried — matches findNavItemsWithRetry's policy.
  private async withStepRetry<T>(fn: () => Promise<T>, page: PatchrightCapturePage): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.stepRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isExecutionContextDestroyedError(err)) throw err;
        lastError = err;
        if (attempt >= this.config.stepRetries) break;
        await page.waitForTimeout(this.config.stepRetryWaitMs);
      }
    }
    throw lastError;
  }

  // Polls (bounded by timeoutMs/intervalMs, via page.waitForTimeout — never a real Node timer, so
  // this stays fully fake-page-testable with no real wall-clock delay) for the URL to change away
  // from beforeUrl. Used to verify both a navigate step's goto and a click step's expected
  // navigation actually took.
  private async waitForUrlChange(
    page: PatchrightCapturePage,
    beforeUrl: string,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<boolean> {
    const attempts = Math.max(1, Math.ceil(timeoutMs / Math.max(1, intervalMs)));
    for (let i = 0; i < attempts; i++) {
      if (page.url() !== beforeUrl) return true;
      await page.waitForTimeout(intervalMs);
    }
    return page.url() !== beforeUrl;
  }

  // Self-healing navigate (design section E): after goto() settles, verify the URL actually
  // changed — a live render can race/swallow a navigation. One retry (re-goto) before degrading
  // gracefully: this is one step of a multi-scene capture, so it logs and continues rather than
  // crashing the whole render over a single unverified navigation.
  private async navigateWithVerification(page: PatchrightCapturePage, url: string): Promise<void> {
    const beforeUrl = page.url();
    await page.goto(url, { waitUntil: this.config.navigateWaitUntil });
    if (!url || url === beforeUrl) return;
    const verifyArgs = [this.config.stepVerifyTimeoutMs, this.config.stepRetryWaitMs] as const;
    if (await this.waitForUrlChange(page, beforeUrl, ...verifyArgs)) return;

    console.warn(`WebRecordingEngine: navigate to "${url}" did not verify — retrying goto once.`);
    await page.goto(url, { waitUntil: this.config.navigateWaitUntil });
    if (!(await this.waitForUrlChange(page, beforeUrl, ...verifyArgs))) {
      console.warn(
        `WebRecordingEngine: navigate to "${url}" still did not verify after retry — continuing capture.`,
      );
    }
  }

  // Click self-heal (design section E): retries the click itself against the context-destroyed
  // race (withStepRetry); if it never lands, logs and skips gracefully — one bad step doesn't
  // crash the whole capture. If the click DID land but was for a plain `a[href="..."]` anchor
  // whose click got intercepted (e.g. by a re-appearing overlay) rather than navigating, falls
  // back to navigating there directly — the href is staticaly recoverable for exactly this
  // selector shape (see ANCHOR_HREF_SELECTOR_RE).
  private async performClick(page: PatchrightCapturePage, selector: string): Promise<void> {
    const beforeUrl = page.url();
    await this.withStepRetry(() => page.click(visibleSelector(selector)), page);
    await this.maybeHealAnchorClick(page, selector, beforeUrl);
  }

  private async maybeHealAnchorClick(
    page: PatchrightCapturePage,
    selector: string,
    beforeUrl: string,
  ): Promise<void> {
    const match = ANCHOR_HREF_SELECTOR_RE.exec(selector);
    if (!match) return;
    const href = match[1] ?? "";
    const changed = await this.waitForUrlChange(
      page,
      beforeUrl,
      this.config.stepVerifyTimeoutMs,
      this.config.stepRetryWaitMs,
    );
    if (changed) return;

    const absoluteUrl = new URL(href, beforeUrl || page.url()).toString();
    console.warn(
      `WebRecordingEngine: click on "${selector}" did not navigate — falling back to goto("${absoluteUrl}").`,
    );
    await page.goto(absoluteUrl, { waitUntil: this.config.navigateWaitUntil });
  }

  // Wait for the SPA to PAINT its content after a navigation (see capture-config contentSettleMs)
  // so a scene doesn't open on a loading skeleton — `load` fires before the SPA renders and
  // `networkidle` never comes (persistent chat/websocket). Returns the ms waited (scene-time).
  private async settleContent(page: PatchrightCapturePage): Promise<number> {
    if (this.config.contentSettleMs <= 0) return 0;
    await page.waitForTimeout(this.config.contentSettleMs);
    return this.config.contentSettleMs;
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
  // no-op (returns 0) when `dismissOverlays` is disabled. Returns the total ms waited so callers
  // can fold it into scene-timing bookkeeping (see capture()/runScene()).
  private async dismissOverlays(page: PatchrightCapturePage): Promise<number> {
    if (!this.config.dismissOverlays) return 0;
    let elapsedMs = 0;
    for (let i = 0; i < this.config.dismissPresses; i++) {
      try {
        await this.withStepRetry(() => page.keyboard.press(this.config.dismissKey), page);
      } catch (err) {
        console.warn(
          `WebRecordingEngine: giving up dismissing overlay via "${this.config.dismissKey}" after retries — ${errorMessage(err)}`,
        );
        break;
      }
      await page.waitForTimeout(this.config.dismissWaitMs);
      elapsedMs += this.config.dismissWaitMs;
    }
    return elapsedMs;
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
