// UrlCredsTarget — Target adapter, platform discovery via patchright (Chromium-only,
// undetected). Logs into a target app with URL + credentials and crawls reachable routes to
// build a re-runnable FlowGraph, persisted as JSON on disk.
//
// DI: the browser launcher is injected (constructor param), never imported/launched at module
// load or class-construction time — same pattern as ElevenLabsVoice. Unit tests pass a fake
// BrowserLauncher/PatchrightPage — no real browser, no network. Only when discover() actually
// runs and no launcher was injected does this adapter lazily launch a real Chromium instance.
// Credentials are read from process.env only inside discover(), never at import/construction —
// so a missing/invalid env surfaces as a clear discover()-time error, not an import crash.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "patchright";
import { sha256 } from "../../domain/artifacts/canonical.js";
import type { DiscoveryFingerprint } from "../../domain/models/capability-profile.js";
import {
  type FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
  parseFlowGraph,
} from "../../domain/models/flow-graph.js";
import type { Target } from "../../domain/ports/target.js";
import { DEFAULT_DISCOVERY_CONFIG, type DiscoveryConfig } from "./discovery-config.js";
import type {
  BrowserLauncher,
  PatchrightBrowser,
  PatchrightElementHandle,
  PatchrightPage,
  UrlCredsEnv,
} from "./login.js";
import {
  isExecutionContextDestroyedError,
  login,
  normalizeUrl,
  readTargetEnvOrThrow,
  resolveLoginConfig,
} from "./login.js";

export type {
  BrowserLauncher,
  PatchrightBrowser,
  PatchrightElementHandle,
  PatchrightPage,
  UrlCredsEnv,
};
// Re-exported for existing/external consumers (e.g. WebRecordingEngine) that import these
// structural patchright types and readTargetEnvOrThrow from this module — the canonical
// definitions now live in ./login.js, shared with capture's login.
export { readTargetEnvOrThrow };

// Robust-selector priority for a discovered nav item: data-testid > id > raw href > visible text
// > tag fallback. CSS/DOM-based only — NEVER `role=` (patchright, the undetected Playwright fork
// used for capture/replay, DISABLES the accessibility tree, so `getByRole`/`role=` selectors match
// ZERO elements on a real page; verified live against camtom-webapp.vercel.app). Prefers stable
// attributes over brittle positional selectors, per the discovery spec's "robust selectors"
// requirement — this feeds later capture/replay.
export async function buildRobustSelector(link: PatchrightElementHandle): Promise<string> {
  const testId = await link.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;

  const id = await link.getAttribute("id");
  if (id) return `#${id}`;

  const href = await link.getAttribute("href");
  if (href) return `a[href="${href}"]`;

  // Playwright/patchright's text engine — DOM text-content matching, not the accessibility tree.
  const text = (await link.textContent())?.trim();
  if (text) return `text="${text}"`;

  // ponytail: no identifying attribute found — last-resort tag selector. An anchor with an empty
  // (but present) href attribute still gets "a"; anything else falls back to "button".
  return href !== null ? "a" : "button";
}

function isSameOrigin(url: string, baseUrl: string): boolean {
  return new URL(url).origin === new URL(baseUrl).origin;
}

// Scopes a container prefix to EACH comma-alternative of a selector list. CSS binds a descendant
// combinator only to the alternative it directly precedes, so `nav a, button` means `nav a` OR any
// `button` — not `nav a` OR `nav button`. This rewrites it to the latter.
function scopeSelectorList(container: string, selectorList: string): string {
  return selectorList
    .split(",")
    .map((part) => `${container} ${part.trim()}`)
    .join(", ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ponytail: feature/useCase tagging is a URL/text heuristic (first path segment = feature, page
// title or link text = useCase) — no NLP/AI classification. Good enough for the thin slice;
// AI-assisted tagging (e.g. via an LLM) is a later upgrade, deliberately not pulled in here.
function featureFromUrl(url: string): string {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  return segments[0] ?? "home";
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "link";
}

const LOWER_THIRD = { x: 96, y: 510, w: 1088, h: 150 };

interface TargetEvidence {
  readonly selector: string;
  readonly semanticTarget: {
    readonly role: "link" | "button";
    readonly accessibleName?: string;
    readonly label?: string;
    readonly testId?: string;
  };
  readonly layoutOccupancy?: { x: number; y: number; w: number; h: number }[];
  readonly safeCaptionRegions?: ("lower-third" | "top")[];
  readonly confidence: "low" | "medium" | "high";
  readonly evidenceRefs: string[];
}

function intersectsLowerThird(region: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): boolean {
  return region.x < LOWER_THIRD.x + LOWER_THIRD.w && region.x + region.w > LOWER_THIRD.x
    && region.y < LOWER_THIRD.y + LOWER_THIRD.h && region.y + region.h > LOWER_THIRD.y;
}

async function targetEvidenceFromDom(
  item: PatchrightElementHandle,
  selector: string,
  targetId: string,
  href: string | null,
  text: string | undefined,
): Promise<TargetEvidence> {
  const [ariaLabel, testId, id, box] = await Promise.all([
    item.getAttribute("aria-label"),
    item.getAttribute("data-testid"),
    item.getAttribute("id"),
    item.boundingBox?.(),
  ]);
  const accessibleName = ariaLabel ?? text;
  const stableId = testId ?? id;
  const layoutOccupancy = box && box.width > 0 && box.height > 0
    ? [{ x: box.x, y: box.y, w: box.width, h: box.height }]
    : undefined;
  const evidenceRefs = [
    `browser:${targetId}`,
    `dom:${selector}`,
    ...(accessibleName ? [`accessibility:${accessibleName}`] : []),
  ].sort();
  return {
    selector,
    semanticTarget: {
      role: href === null ? "button" : "link",
      ...(accessibleName ? { accessibleName } : {}),
      ...(text ? { label: slugify(text) } : {}),
      ...(stableId ? { testId: stableId } : {}),
    },
    ...(layoutOccupancy ? { layoutOccupancy } : {}),
    ...(layoutOccupancy
      ? { safeCaptionRegions: [intersectsLowerThird(layoutOccupancy[0]!) ? "top" : "lower-third"] }
      : {}),
    confidence: stableId && accessibleName && layoutOccupancy ? "high" : accessibleName || stableId ? "medium" : "low",
    evidenceRefs,
  };
}

export class UrlCredsTarget implements Target {
  private readonly injectedLauncher: BrowserLauncher | undefined;
  private readonly config: DiscoveryConfig;

  constructor(launcher?: BrowserLauncher, config: Partial<DiscoveryConfig> = {}) {
    this.injectedLauncher = launcher;
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  async getDiscoveryFingerprint(): Promise<DiscoveryFingerprint> {
    const env = readTargetEnvOrThrow();
    const loginConfig = resolveLoginConfig(this.config);
    const browser = await (this.injectedLauncher ?? (() => this.launchDefaultBrowser()))();
    try {
      const page = await browser.newPage();
      await login(page, env, loginConfig);
      const body = (await page.$$("body"))[0];
      const content = body ? ((await body.textContent()) ?? "") : "";
      return {
        url: sha256({ url: normalizeUrl(page.url() || env.url) }),
        build: sha256({ loginConfig, nav: this.config.navItemSelector }),
        content: sha256({ title: await page.title(), content }),
        loginSelectors: {
          username: loginConfig.usernameSelector,
          password: loginConfig.passwordSelector,
          submit: loginConfig.submitSelector,
        },
      };
    } finally {
      await browser.close();
    }
  }

  async discover(): Promise<FlowGraph> {
    const env = readTargetEnvOrThrow();
    const browser = await (this.injectedLauncher ?? (() => this.launchDefaultBrowser()))();

    try {
      const page = await browser.newPage();
      // Shared login (see ./login.js): SAME hydration-aware fill + URL-change-first success
      // detection + real-text-only error detection used by capture (WebRecordingEngine). This
      // adapter's DiscoveryConfig structurally satisfies LoginConfig (superset of its fields).
      await login(page, env, resolveLoginConfig(this.config));
      const graph = parseFlowGraph(await this.crawl(page, page.url() || env.url));
      await this.persist(graph);
      return graph;
    } finally {
      await browser.close();
    }
  }

  // Own poll-based waiter (not a native waitForURL) — keeps both login-outcome and nav-click
  // detection testable purely against a fake page's synchronous url() mutation, while still
  // respecting a real timeout budget against a live browser.
  private async waitForUrlChange(
    page: PatchrightPage,
    beforeUrl: string,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<boolean> {
    const before = normalizeUrl(beforeUrl);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const current = page.url();
      if (current && normalizeUrl(current) !== before) return true;
      if (Date.now() >= deadline) return false;
      await sleep(intervalMs);
    }
  }

  // SPA-aware primary-nav discovery. Anchors (`a[href]`) are the reliable, FAST signal — the crawl
  // reads their href without clicking — so prefer them: within a nav container first, then the
  // whole page. Only when a page exposes NO anchors at all do we fall back to clickable
  // button/router items (pure client-router SPA), which cost a click + URL-change wait each.
  //
  // The fallback scopes EACH comma-alternative of navItemSelector to the container: a naive
  // `${container} ${listSelector}` only binds the container to the first alternative, leaking
  // every unscoped page button into nav discovery and burning a click+timeout on each (real e2e).
  private async findNavItems(page: PatchrightPage): Promise<PatchrightElementHandle[]> {
    for (const container of this.config.navContainerSelectors) {
      const anchors = await page.$$(`${container} a[href]`);
      if (anchors.length > 0) return anchors;
    }
    const pageAnchors = await page.$$("a[href]");
    if (pageAnchors.length > 0) return pageAnchors;

    for (const container of this.config.navContainerSelectors) {
      const scoped = scopeSelectorList(container, this.config.navItemSelector);
      const items = await page.$$(scoped);
      if (items.length > 0) return items;
    }
    return page.$$(this.config.navItemSelector);
  }

  // Wraps findNavItems() with a bounded retry against the "Execution context was destroyed"
  // navigation race (see login.ts's isExecutionContextDestroyedError): a late SPA redirect right after crawl's
  // goto() can invalidate the page's execution context before the $$ queries inside findNavItems
  // run. Each retry re-settles the page (re-goto its current URL, respecting gotoWaitUntil) before
  // querying again, so a subsequent attempt reads a fresh, stable context. Any other error is not
  // this race — it propagates immediately, unretried. Budget exhausted: this page's nav items are
  // skipped (treated as none found) rather than failing the whole crawl over one flaky page — the
  // page node itself is still recorded, just without outgoing edges.
  private async findNavItemsWithRetry(
    page: PatchrightPage,
    currentUrl: string,
  ): Promise<PatchrightElementHandle[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.navQueryRetries; attempt++) {
      try {
        return await this.findNavItems(page);
      } catch (err) {
        if (!isExecutionContextDestroyedError(err)) throw err;
        lastError = err;
        if (attempt >= this.config.navQueryRetries) break;
        await sleep(this.config.navQueryRetryWaitMs);
        try {
          await page.goto(page.url() || currentUrl, { waitUntil: this.config.gotoWaitUntil });
        } catch {
          // Settling failed too — retry the query anyway; if the page is truly gone it will throw
          // again and the budget above will still bound the attempts.
        }
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    console.warn(
      `UrlCredsTarget: giving up on nav-item discovery for ${currentUrl} after ` +
        `${this.config.navQueryRetries + 1} attempt(s) — ${reason}`,
    );
    return [];
  }

  private async crawl(page: PatchrightPage, startUrl: string): Promise<FlowGraph> {
    const nodes: FlowGraphNode[] = [];
    const edges: FlowGraphEdge[] = [];
    const visited = new Set<string>();
    const queued = new Set<string>([normalizeUrl(startUrl)]);
    const queue: string[] = [startUrl];
    const incomingEvidence = new Map<string, TargetEvidence[]>();

    // ponytail: budget enforced by this loop condition alone (visited.size < maxPages) — the
    // queue itself is left unbounded (dedup via `queued`) since the thin slice never crawls
    // enough pages for that to matter. Cap `maxPages` (DiscoveryConfig) to widen/narrow the crawl.
    while (queue.length > 0 && visited.size < this.config.maxPages) {
      const currentUrl = queue.shift();
      if (!currentUrl) continue;
      const nodeId = normalizeUrl(currentUrl);
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      if (normalizeUrl(page.url()) !== nodeId) {
        await page.goto(currentUrl, { waitUntil: this.config.gotoWaitUntil });
      }

      const title = await page.title();
      // ponytail: bounded to the primary navigation (nav/aside/role=navigation containers, or a
      // whole-page interactive-item fallback) up to maxPages total nodes — not an exhaustive
      // click-everything crawler. Upgrade path: a relevance-ranked frontier or an explicit route
      // list once discovery needs to cover more than a primary nav's worth of an app.
      const navItems = await this.findNavItemsWithRetry(page, currentUrl);
      const selectors: Record<string, string> = {};

      for (const item of navItems) {
        const href = await item.getAttribute("href");
        const selector = await buildRobustSelector(item);
        const text = (await item.textContent())?.trim();
        let targetUrl: string;

        if (href) {
          // Anchor with a real href — no need to click; the target URL is already known.
          targetUrl = new URL(href, currentUrl).toString();
          if (!isSameOrigin(targetUrl, startUrl)) continue;
        } else {
          // No href — a button/router-driven nav item (client-side routing). Click it, wait for
          // the URL to change, record the resulting route, then return to the base page to try
          // the next item.
          const before = page.url();
          await page.click(selector);
          const navigated = await this.waitForUrlChange(
            page,
            before,
            this.config.navClickTimeoutMs,
            this.config.navPollIntervalMs,
          );
          if (!navigated) continue;

          const after = page.url();
          if (!isSameOrigin(after, startUrl)) {
            await page.goBack();
            continue;
          }
          targetUrl = after;
          await page.goBack();
        }

        selectors[slugify(text || href || targetUrl)] = selector;
        const targetId = normalizeUrl(targetUrl);
        edges.push({ from: nodeId, to: targetId, action: `click ${selector}` });
        const evidence = await targetEvidenceFromDom(item, selector, targetId, href, text);
        incomingEvidence.set(targetId, [...(incomingEvidence.get(targetId) ?? []), evidence]);

        if (!visited.has(targetId) && !queued.has(targetId)) {
          queued.add(targetId);
          queue.push(targetUrl);
        }
      }

      const entryEvidence = [...(incomingEvidence.get(nodeId) ?? [])]
        .sort((left, right) => left.selector.localeCompare(right.selector) || sha256(left).localeCompare(sha256(right)))[0];
      nodes.push({
        id: nodeId,
        feature: featureFromUrl(currentUrl),
        useCase: title || featureFromUrl(currentUrl),
        // ponytail: precondition inference is a stub — every discovered node is tagged
        // "authenticated" since discovery always runs post-login. Real per-node precondition
        // detection (e.g. requires a prior action) is a later upgrade.
        preconditions: ["authenticated"],
        selectors,
        // Patchright intentionally does not expose an accessibility tree, so use a deterministic
        // DOM snapshot (title + normalized nav locators) as state evidence. The capability profile
        // preserves semantic selector hints without introducing a per-page LLM dependency.
        locatorEvidence: {
          candidates: Object.values(selectors).sort(),
          urlFingerprint: sha256({ url: nodeId }),
          buildFingerprint: sha256({ navItemSelector: this.config.navItemSelector }),
          stateFingerprint: sha256({ title, selectors }),
          ...(entryEvidence === undefined
            ? {}
            : {
                semanticTarget: entryEvidence.semanticTarget,
                postcondition: {
                  selector: entryEvidence.selector,
                  evidence: `${title || entryEvidence.semanticTarget.accessibleName || "Destination"} is visible at ${nodeId}`,
                },
                ...(entryEvidence.layoutOccupancy === undefined
                  ? {}
                  : { layoutOccupancy: entryEvidence.layoutOccupancy }),
                ...(entryEvidence.safeCaptionRegions === undefined
                  ? {}
                  : { safeCaptionRegions: entryEvidence.safeCaptionRegions }),
                confidence: entryEvidence.confidence,
                evidenceRefs: entryEvidence.evidenceRefs,
              }),
        },
      });
    }

    return { nodes, edges };
  }

  private async persist(graph: FlowGraph): Promise<void> {
    await mkdir(dirname(this.config.outputPath), { recursive: true });
    await writeFile(this.config.outputPath, JSON.stringify(graph, null, 2), "utf8");
  }

  // Lazy: only launches a real browser the first time discover() actually needs one and none
  // was injected. Never runs at import or construction time.
  private async launchDefaultBrowser(): Promise<PatchrightBrowser> {
    return chromium.launch({ headless: true });
  }
}
