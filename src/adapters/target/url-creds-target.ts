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

// Narrow structural subset of patchright's Page — only what this adapter calls.
export interface PatchrightPage {
  goto(url: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
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

// Robust-selector priority for a discovered link: data-testid > accessible name (role/text) >
// id > raw href. Prefers stable attributes over brittle positional selectors, per the discovery
// spec's "robust selectors" requirement — this feeds later capture/replay.
export async function buildRobustSelector(link: PatchrightElementHandle): Promise<string> {
  const testId = await link.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;

  const ariaLabel = await link.getAttribute("aria-label");
  if (ariaLabel) return `role=link[name="${ariaLabel}"]`;

  const text = (await link.textContent())?.trim();
  if (text) return `role=link[name="${text}"]`;

  const id = await link.getAttribute("id");
  if (id) return `#${id}`;

  const href = await link.getAttribute("href");
  return `a[href="${href ?? ""}"]`;
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

function isSameOrigin(url: string, baseUrl: string): boolean {
  return new URL(url).origin === new URL(baseUrl).origin;
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

  private async login(page: PatchrightPage, env: UrlCredsEnv): Promise<void> {
    await page.goto(env.url);
    await page.fill(this.config.usernameSelector, env.username);
    await page.fill(this.config.passwordSelector, env.password);
    await page.click(this.config.submitSelector);
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

      if (page.url() !== currentUrl) {
        await page.goto(currentUrl);
      }

      const title = await page.title();
      const links = await page.$$("a[href]");
      const selectors: Record<string, string> = {};

      for (const link of links) {
        const href = await link.getAttribute("href");
        if (!href) continue;

        const targetUrl = new URL(href, currentUrl).toString();
        if (!isSameOrigin(targetUrl, startUrl)) continue;

        const selector = await buildRobustSelector(link);
        const text = (await link.textContent())?.trim();
        selectors[slugify(text || href)] = selector;
        edges.push({ from: nodeId, to: normalizeUrl(targetUrl), action: `click ${selector}` });

        const targetId = normalizeUrl(targetUrl);
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
