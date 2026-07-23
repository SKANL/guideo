import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserLauncher,
  PatchrightBrowser,
  PatchrightElementHandle,
  PatchrightPage,
} from "../../../src/adapters/target/url-creds-target.js";
import {
  buildRobustSelector,
  UrlCredsTarget,
} from "../../../src/adapters/target/url-creds-target.js";
import { FlowGraphSchema } from "../../../src/domain/models/flow-graph.js";

const BASE_URL = "https://target.example.com";
const LOGIN_URL = `${BASE_URL}/login`;
const HOME_URL = `${BASE_URL}/home`;
const SUBMIT_SELECTOR = 'button[type="submit"]';

interface FakeLinkSpec {
  href: string;
  text?: string;
  testid?: string;
}

interface FakePageSpec {
  title: string;
  links: FakeLinkSpec[];
}

function fakeLink(spec: FakeLinkSpec): PatchrightElementHandle {
  return {
    async getAttribute(name) {
      if (name === "href") return spec.href;
      if (name === "data-testid") return spec.testid ?? null;
      return null;
    },
    async textContent() {
      return spec.text ?? null;
    },
  };
}

function normalize(url: string): string {
  const parsed = new URL(url, BASE_URL);
  return `${parsed.origin}${parsed.pathname}`;
}

// Builds a fake single-page-per-URL "site" driven purely through PatchrightPage calls — no real
// browser, no network. Clicking SUBMIT_SELECTOR simulates a login redirect to `postLoginUrl`.
function fakeSite(pages: Record<string, FakePageSpec>, postLoginUrl = HOME_URL) {
  let currentUrl = "";
  const goto = vi.fn(async (url: string) => {
    currentUrl = url;
  });
  const fill = vi.fn(async () => {});
  const click = vi.fn(async (selector: string) => {
    if (selector === SUBMIT_SELECTOR) currentUrl = postLoginUrl;
  });

  const page: PatchrightPage = {
    goto,
    fill,
    click,
    url: () => currentUrl,
    title: async () => pages[normalize(currentUrl)]?.title ?? "",
    $$: async (selector: string) => {
      if (selector !== "a[href]") return [];
      return (pages[normalize(currentUrl)]?.links ?? []).map(fakeLink);
    },
    close: async () => {},
  };

  const browser: PatchrightBrowser = {
    newPage: async () => page,
    close: vi.fn(async () => {}),
  };

  const launcher: BrowserLauncher = vi.fn(async () => browser);

  return { page, browser, launcher, goto, fill, click };
}

describe("UrlCredsTarget", () => {
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

  it("drives the fake page (goto, fill creds, navigate) and emits a valid FlowGraph", async () => {
    const { launcher, goto, fill, click } = fakeSite({
      [normalize(HOME_URL)]: {
        title: "Home",
        links: [{ href: "/settings", text: "Settings" }],
      },
      [normalize(`${BASE_URL}/settings`)]: { title: "Settings", links: [] },
    });
    const outputPath = join(tmpdir(), `guideo-flowgraph-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, { outputPath, maxPages: 10 });

    const graph = await target.discover();

    expect(goto).toHaveBeenCalledWith(LOGIN_URL);
    expect(fill).toHaveBeenCalledWith(expect.stringContaining("username"), "alice");
    expect(fill).toHaveBeenCalledWith(expect.stringContaining("password"), "s3cret");
    expect(click).toHaveBeenCalledWith(SUBMIT_SELECTOR);

    expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(HOME_URL));
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(`${BASE_URL}/settings`));
    expect(graph.edges).toContainEqual({
      from: normalize(HOME_URL),
      to: normalize(`${BASE_URL}/settings`),
      action: expect.stringContaining("click"),
    });

    await rm(outputPath, { force: true });
  });

  it("throws a clear error at discover() time when required env vars are missing, not at import", async () => {
    delete process.env.GUIDEO_TARGET_URL;
    delete process.env.GUIDEO_TARGET_USERNAME;
    delete process.env.GUIDEO_TARGET_PASSWORD;
    const { launcher } = fakeSite({});
    const target = new UrlCredsTarget(launcher);

    await expect(target.discover()).rejects.toThrow(/GUIDEO_TARGET_URL/);
    await expect(target.discover()).rejects.toThrow(/GUIDEO_TARGET_USERNAME/);
    await expect(target.discover()).rejects.toThrow(/GUIDEO_TARGET_PASSWORD/);
  });

  it("respects the page budget and stops crawling once maxPages is reached", async () => {
    // A chain of 10 linked pages, budget capped to 3.
    const pages: Record<string, FakePageSpec> = {};
    for (let i = 0; i < 10; i++) {
      const url = normalize(`${BASE_URL}/page-${i}`);
      pages[url] = {
        title: `Page ${i}`,
        links: [{ href: `/page-${i + 1}`, text: `Next ${i + 1}` }],
      };
    }
    const { launcher } = fakeSite(pages, normalize(`${BASE_URL}/page-0`));
    const outputPath = join(tmpdir(), `guideo-flowgraph-budget-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, { outputPath, maxPages: 3 });

    const graph = await target.discover();

    expect(graph.nodes.length).toBe(3);
    await rm(outputPath, { force: true });
  });

  it("persists the FlowGraph as JSON on disk, and re-running overwrites it", async () => {
    const outputPath = join(tmpdir(), `guideo-flowgraph-persist-${Date.now()}.json`);

    const first = fakeSite({
      [normalize(HOME_URL)]: { title: "Home", links: [{ href: "/a", text: "A" }] },
      [normalize(`${BASE_URL}/a`)]: { title: "A", links: [] },
    });
    const target1 = new UrlCredsTarget(first.launcher, { outputPath, maxPages: 10 });
    await target1.discover();
    const firstContents = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(firstContents.nodes).toHaveLength(2);

    const second = fakeSite({
      [normalize(HOME_URL)]: {
        title: "Home",
        links: [
          { href: "/a", text: "A" },
          { href: "/b", text: "B" },
        ],
      },
      [normalize(`${BASE_URL}/a`)]: { title: "A", links: [] },
      [normalize(`${BASE_URL}/b`)]: { title: "B", links: [] },
    });
    const target2 = new UrlCredsTarget(second.launcher, { outputPath, maxPages: 10 });
    await target2.discover();
    const secondContents = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(secondContents.nodes).toHaveLength(3);

    await rm(outputPath, { force: true });
  });
});

describe("buildRobustSelector", () => {
  it("prefers data-testid over every other attribute", async () => {
    const selector = await buildRobustSelector(
      fakeLink({ href: "/x", text: "Ignored", testid: "nav-dashboard" }),
    );
    expect(selector).toBe('[data-testid="nav-dashboard"]');
  });

  it("falls back to an accessible text/role selector when no testid is present", async () => {
    const selector = await buildRobustSelector(fakeLink({ href: "/x", text: "Dashboard" }));
    expect(selector).toBe('role=link[name="Dashboard"]');
  });

  it("falls back to the raw href as a last resort", async () => {
    const selector = await buildRobustSelector(fakeLink({ href: "/x" }));
    expect(selector).toBe('a[href="/x"]');
  });
});
