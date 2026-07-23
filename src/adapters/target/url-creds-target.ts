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
import {
  type FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
  parseFlowGraph,
} from "../../domain/models/flow-graph.js";
import type { Target } from "../../domain/ports/target.js";
import { DEFAULT_DISCOVERY_CONFIG, type DiscoveryConfig } from "./discovery-config.js";

// Narrow structural subset of patchright's ElementHandle — only what this adapter reads to build
// a robust selector for a discovered link. A real patchright ElementHandle satisfies this
// structurally; unit tests can pass a plain fake object literal.
export interface PatchrightElementHandle {
  getAttribute(name: string): Promise<string | null>;
  textContent(): Promise<string | null>;
}

type WaitUntil = "load" | "domcontentloaded" | "networkidle";

// Narrow structural subset of patchright's Page — only what this adapter calls. `goto`/`goBack`
// options and `waitForSelector` match real patchright/Playwright signatures structurally, so a
// real Chromium page satisfies this interface with zero adapter-side shimming.
export interface PatchrightPage {
  goto(url: string, options?: { waitUntil?: WaitUntil }): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  goBack(options?: { waitUntil?: WaitUntil }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  $$(selector: string): Promise<PatchrightElementHandle[]>;
  close(): Promise<void>;
}

// Narrow structural subset of patchright's Browser.
export interface PatchrightBrowser {
  newPage(): Promise<PatchrightPage>;
  close(): Promise<void>;
}

export type BrowserLauncher = () => Promise<PatchrightBrowser>;

export interface UrlCredsEnv {
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

const REQUIRED_ENV_VARS = [
  ["GUIDEO_TARGET_URL", "url"],
  ["GUIDEO_TARGET_USERNAME", "username"],
  ["GUIDEO_TARGET_PASSWORD", "password"],
] as const;

// Reads target URL/credentials from env. Called only at discover()-time (never at import or
// construction) so a missing env produces a clear error exactly when discovery is attempted.
export function readTargetEnvOrThrow(): UrlCredsEnv {
  const values: Partial<Record<"url" | "username" | "password", string>> = {};
  const missing: string[] = [];
  for (const [envVar, key] of REQUIRED_ENV_VARS) {
    const value = process.env[envVar];
    if (!value) {
      missing.push(envVar);
    } else {
      values[key] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `UrlCredsTarget.discover() requires env var(s) ${missing.join(", ")}. Load them via ` +
        "`node --env-file=.env` (or export them) before calling discover().",
    );
  }
  const { url, username, password } = values;
  if (!url || !username || !password) {
    throw new Error("UrlCredsTarget.discover(): unexpected missing env value.");
  }
  return { url, username, password };
}

// Robust-selector priority for a discovered nav item: data-testid > accessible role/name >
// id > raw href > tag fallback. Prefers stable attributes over brittle positional selectors, per
// the discovery spec's "robust selectors" requirement — this feeds later capture/replay. Role
// defaults to "link" for anchors and "button" for everything else (buttons/role items), or uses
// an explicit `role` attribute when present.
export async function buildRobustSelector(link: PatchrightElementHandle): Promise<string> {
  const testId = await link.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;

  const href = await link.getAttribute("href");
  const explicitRole = await link.getAttribute("role");
  const roleName = explicitRole || (href ? "link" : "button");

  const ariaLabel = await link.getAttribute("aria-label");
  if (ariaLabel) return `role=${roleName}[name="${ariaLabel}"]`;

  const text = (await link.textContent())?.trim();
  if (text) return `role=${roleName}[name="${text}"]`;

  const id = await link.getAttribute("id");
  if (id) return `#${id}`;

  if (href) return `a[href="${href}"]`;

  // ponytail: no identifying attribute found on a non-anchor item — rare given real nav items
  // normally carry visible text or an aria-label; last-resort tag selector.
  return "button";
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
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

const LOGIN_FAILED_MESSAGE =
  "Login failed — check GUIDEO_TARGET_USERNAME/PASSWORD; the target reported invalid " +
  "credentials or never left the login page.";

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

export class UrlCredsTarget implements Target {
  private readonly injectedLauncher: BrowserLauncher | undefined;
  private readonly config: DiscoveryConfig;

  constructor(launcher?: BrowserLauncher, config: Partial<DiscoveryConfig> = {}) {
    this.injectedLauncher = launcher;
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  async discover(): Promise<FlowGraph> {
    const env = readTargetEnvOrThrow();
    const browser = await (this.injectedLauncher ?? (() => this.launchDefaultBrowser()))();

    try {
      const page = await browser.newPage();
      await this.login(page, env);
      const graph = parseFlowGraph(await this.crawl(page, page.url() || env.url));
      await this.persist(graph);
      return graph;
    } finally {
      await browser.close();
    }
  }

  // Hydration-aware: waits for the login form to actually exist (SPAs render it post-JS-boot,
  // so filling immediately after goto() would hit an empty DOM) before filling/submitting, then
  // verifies the login actually succeeded — no silent proceed on bad creds or a stuck SPA.
  private async login(page: PatchrightPage, env: UrlCredsEnv): Promise<void> {
    await page.goto(env.url, { waitUntil: this.config.gotoWaitUntil });
    await page.waitForSelector(this.config.passwordSelector, {
      timeout: this.config.formWaitTimeoutMs,
    });
    // The ACTUAL login URL after any redirect (env.url may be the app root "/" that redirects to
    // "/login"). Login success is a transition away from THIS url — comparing against env.url would
    // read the initial redirect as an instant false success (real e2e).
    const loginUrl = page.url() || env.url;
    await page.fill(this.config.usernameSelector, env.username);
    await page.fill(this.config.passwordSelector, env.password);
    await page.click(this.config.submitSelector);
    await this.verifyLoginSucceeded(page, loginUrl);
  }

  // Polls (bounded by loginTimeoutMs) for either an auth-error indicator or a URL change away
  // from the login route. Throws a clear, actionable error otherwise — never silently proceeds
  // to crawl on a failed login (see e2e-findings: was a silent-failure bug producing a useless
  // 2-node graph with exit 0).
  private async verifyLoginSucceeded(page: PatchrightPage, loginUrl: string): Promise<void> {
    const normalizedLoginUrl = normalizeUrl(loginUrl);
    const deadline = Date.now() + this.config.loginTimeoutMs;

    while (true) {
      // Success takes priority: a URL change away from the login route means we're authenticated.
      const currentUrl = page.url();
      if (currentUrl && normalizeUrl(currentUrl) !== normalizedLoginUrl) return;

      // A failure requires a REAL error — an error element carrying actual text. An always-present
      // empty [role=alert]/aria-live container (common in SPAs) matches the selector but has no
      // text; treating its mere presence as a failure false-positived logins that had actually
      // succeeded (see e2e-findings).
      if (await this.hasRealError(page)) throw new Error(LOGIN_FAILED_MESSAGE);

      if (Date.now() >= deadline) throw new Error(LOGIN_FAILED_MESSAGE);
      await sleep(this.config.loginPollIntervalMs);
    }
  }

  // True only if at least one error-selector match carries non-empty text — guards against
  // always-present empty alert/aria-live containers that match the selector but signal nothing.
  private async hasRealError(page: PatchrightPage): Promise<boolean> {
    for (const el of await page.$$(this.config.loginErrorSelector)) {
      if ((await el.textContent())?.trim()) return true;
    }
    return false;
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

  private async crawl(page: PatchrightPage, startUrl: string): Promise<FlowGraph> {
    const nodes: FlowGraphNode[] = [];
    const edges: FlowGraphEdge[] = [];
    const visited = new Set<string>();
    const queued = new Set<string>([normalizeUrl(startUrl)]);
    const queue: string[] = [startUrl];

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
      const navItems = await this.findNavItems(page);
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

        if (!visited.has(targetId) && !queued.has(targetId)) {
          queued.add(targetId);
          queue.push(targetUrl);
        }
      }

      nodes.push({
        id: nodeId,
        feature: featureFromUrl(currentUrl),
        useCase: title || featureFromUrl(currentUrl),
        // ponytail: precondition inference is a stub — every discovered node is tagged
        // "authenticated" since discovery always runs post-login. Real per-node precondition
        // detection (e.g. requires a prior action) is a later upgrade.
        preconditions: ["authenticated"],
        selectors,
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
