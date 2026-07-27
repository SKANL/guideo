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

// Short timeouts so the RED (login-stays-on-/login) path doesn't slow the suite down.
const FAST_LOGIN_WAIT = { loginTimeoutMs: 30, loginPollIntervalMs: 5 };

interface FakeLinkSpec {
  href: string;
  text?: string;
  testid?: string;
  id?: string;
}

interface FakePageSpec {
  title: string;
  links: FakeLinkSpec[];
}

function fakeLink(spec: FakeLinkSpec): PatchrightElementHandle {
  return {
    async getAttribute(name) {
      // Empty string means "not an anchor" (no href attribute at all) throughout this fixture's
      // callers — mirrors a real DOM button, which has no href attribute to read.
      if (name === "href") return spec.href || null;
      if (name === "data-testid") return spec.testid ?? null;
      if (name === "id") return spec.id ?? null;
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

// Builds a fake single-page-per-URL anchor-based "site" driven purely through PatchrightPage
// calls — no real browser, no network. Clicking SUBMIT_SELECTOR simulates a login redirect to
// `postLoginUrl`. `$$` emulates a real browser's comma-separated CSS selector list semantics: a
// query matches if ANY comma-separated part matches (here only the literal "a[href]" part is
// modeled, since these fixture pages have no nav containers — proving the crawler's
// container-first-then-bare-fallback nav discovery still finds plain anchors).
function fakeSite(pages: Record<string, FakePageSpec>, postLoginUrl = HOME_URL) {
  let currentUrl = "";
  const goto = vi.fn(async (url: string) => {
    currentUrl = url;
  });
  const fill = vi.fn(async () => {});
  const click = vi.fn(async (selector: string) => {
    if (selector === SUBMIT_SELECTOR) currentUrl = postLoginUrl;
  });
  const waitForSelector = vi.fn(async () => {});
  const goBack = vi.fn(async () => {});

  const page: PatchrightPage = {
    goto,
    fill,
    click,
    waitForSelector,
    goBack,
    url: () => currentUrl,
    title: async () => pages[normalize(currentUrl)]?.title ?? "",
    $$: async (selector: string) => {
      const parts = selector.split(",").map((part) => part.trim());
      if (!parts.includes("a[href]")) return [];
      return (pages[normalize(currentUrl)]?.links ?? []).map(fakeLink);
    },
    close: async () => {},
  };

  const browser: PatchrightBrowser = {
    newPage: async () => page,
    close: vi.fn(async () => {}),
  };

  const launcher: BrowserLauncher = vi.fn(async () => browser);

  return { page, browser, launcher, goto, fill, click, waitForSelector, goBack };
}

// Fake site that never leaves LOGIN_URL after the submit click (bad creds / SPA that stays put),
// optionally exposing an auth-error banner element matched by `errorSelector`.
function fakeStuckLoginSite(options: { showErrorBanner?: boolean; errorSelector?: string } = {}) {
  let currentUrl = "";
  const goto = vi.fn(async (url: string) => {
    currentUrl = url;
  });
  const fill = vi.fn(async () => {});
  const click = vi.fn(async () => {
    // stays on the login page regardless of submit — simulates invalid creds
  });
  const waitForSelector = vi.fn(async () => {});
  const goBack = vi.fn(async () => {});

  const page: PatchrightPage = {
    goto,
    fill,
    click,
    waitForSelector,
    goBack,
    url: () => currentUrl,
    title: async () => "Login",
    $$: async (selector: string) => {
      if (options.showErrorBanner && selector === options.errorSelector) {
        return [fakeLink({ href: "", text: "Invalid login credentials" })];
      }
      return [];
    },
    close: async () => {},
  };

  const browser: PatchrightBrowser = {
    newPage: async () => page,
    close: vi.fn(async () => {}),
  };

  const launcher: BrowserLauncher = vi.fn(async () => browser);
  return { launcher };
}

// A single-page SPA "home" whose primary nav is BUTTONS (no <a href> anywhere) identified by
// data-testid, matching a `[data-nav-btn]`-style item selector (config-overridden by the test so
// the fake doesn't need to guess the real default selector string). Clicking a nav button updates
// the URL synchronously (client-side router), proving anchor-only discovery is gone.
function fakeSpaButtonNavSite() {
  const REPORTS_URL = `${BASE_URL}/reports`;
  const SETTINGS_URL = `${BASE_URL}/settings`;
  const titles: Record<string, string> = {
    [normalize(HOME_URL)]: "Home",
    [normalize(REPORTS_URL)]: "Reports",
    [normalize(SETTINGS_URL)]: "Settings",
  };
  const navButtons = [
    { testid: "nav-reports", text: "Reports", targetUrl: REPORTS_URL },
    { testid: "nav-settings", text: "Settings", targetUrl: SETTINGS_URL },
  ];

  let currentUrl = "";
  let previousUrl = "";
  const goto = vi.fn(async (url: string) => {
    previousUrl = currentUrl;
    currentUrl = url;
  });
  const fill = vi.fn(async () => {});
  const click = vi.fn(async (selector: string) => {
    if (selector === SUBMIT_SELECTOR) {
      previousUrl = currentUrl;
      currentUrl = HOME_URL;
      return;
    }
    const nav = navButtons.find((b) => selector === `[data-testid="${b.testid}"]`);
    if (nav) {
      previousUrl = currentUrl;
      currentUrl = nav.targetUrl;
    }
  });
  const waitForSelector = vi.fn(async () => {});
  const goBack = vi.fn(async () => {
    currentUrl = previousUrl;
  });

  const page: PatchrightPage = {
    goto,
    fill,
    click,
    waitForSelector,
    goBack,
    url: () => currentUrl,
    title: async () => titles[normalize(currentUrl)] ?? "",
    $$: async (selector: string) => {
      // Only the bare fallback item selector resolves (no "nav" container in this fixture) —
      // proving container-first-then-fallback nav discovery works with a fully custom selector.
      if (selector === "[data-nav-btn]" && normalize(currentUrl) === normalize(HOME_URL)) {
        return navButtons.map((b) => fakeLink({ href: "", text: b.text, testid: b.testid }));
      }
      return [];
    },
    close: async () => {},
  };

  const browser: PatchrightBrowser = {
    newPage: async () => page,
    close: vi.fn(async () => {}),
  };

  const launcher: BrowserLauncher = vi.fn(async () => browser);
  return { launcher, REPORTS_URL, SETTINGS_URL };
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

    expect(goto).toHaveBeenCalledWith(LOGIN_URL, { waitUntil: "networkidle" });
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

  // --- Defect 1: silent login failure -------------------------------------------------------

  it("throws a clear, actionable error when the page never leaves the login route after submit", async () => {
    const { launcher } = fakeStuckLoginSite();
    const target = new UrlCredsTarget(launcher, FAST_LOGIN_WAIT);

    await expect(target.discover()).rejects.toThrow(
      /Login failed.*GUIDEO_TARGET_USERNAME\/PASSWORD/,
    );
  });

  it("throws the clear login-failed error when an auth-error banner is present", async () => {
    const errorSelector =
      '[role="alert"], [data-testid="auth-error"], .error, .alert-error, [class*="error"]';
    const { launcher } = fakeStuckLoginSite({ showErrorBanner: true, errorSelector });
    const target = new UrlCredsTarget(launcher, {
      ...FAST_LOGIN_WAIT,
      loginErrorSelector: errorSelector,
    });

    await expect(target.discover()).rejects.toThrow(/Login failed/);
  });

  it("does not throw when the page transitions to an authenticated route after submit", async () => {
    const { launcher } = fakeSite({
      [normalize(HOME_URL)]: { title: "Home", links: [] },
    });
    const outputPath = join(tmpdir(), `guideo-flowgraph-authok-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, { outputPath, ...FAST_LOGIN_WAIT });

    await expect(target.discover()).resolves.not.toThrow();

    await rm(outputPath, { force: true });
  });

  // Regression (real e2e): the target URL is the app root ("/"), which REDIRECTS to "/login".
  // Login success must be judged against the actual (post-redirect) login URL, not env.url — else
  // seeing "/login" ≠ "/" reads as an instant false success, and the crawl maps the login page.
  it("fails loudly when the app redirects to a login page and submit never leaves it", async () => {
    const ROOT_URL = `${BASE_URL}/`;
    process.env.GUIDEO_TARGET_URL = ROOT_URL;
    let currentUrl = "";
    const page: PatchrightPage = {
      goto: async () => {
        currentUrl = LOGIN_URL; // app redirects root -> /login
      },
      waitForSelector: async () => {},
      fill: async () => {},
      click: async () => {
        // submit does NOT leave /login (async login still pending, or bad creds)
      },
      goBack: async () => {},
      url: () => currentUrl,
      title: async () => "Login",
      $$: async () => [],
      close: async () => {},
    };
    const browser: PatchrightBrowser = { newPage: async () => page, close: async () => {} };
    const launcher: BrowserLauncher = async () => browser;
    const target = new UrlCredsTarget(launcher, FAST_LOGIN_WAIT);

    await expect(target.discover()).rejects.toThrow(/Login failed/);
  });

  // Regression (real e2e): an always-present EMPTY [role=alert]/aria-live container matches the
  // error selector but is NOT an auth error. Login succeeds (URL transitions), so discover() must
  // NOT throw just because an empty error container exists in the DOM.
  it("does not treat an always-present empty error container as a login failure", async () => {
    const errorSelector = '[role="alert"], .error';
    let currentUrl = "";
    const page: PatchrightPage = {
      goto: async (url) => {
        currentUrl = url;
      },
      waitForSelector: async () => {},
      fill: async () => {},
      click: async (selector) => {
        if (selector === SUBMIT_SELECTOR) currentUrl = HOME_URL;
      },
      goBack: async () => {},
      url: () => currentUrl,
      title: async () => "Home",
      $$: async (selector: string) => {
        // The empty error container is always present (empty text = not a real error).
        if (selector === errorSelector) return [fakeLink({ href: "", text: "" })];
        return [];
      },
      close: async () => {},
    };
    const browser: PatchrightBrowser = { newPage: async () => page, close: async () => {} };
    const launcher: BrowserLauncher = async () => browser;
    const outputPath = join(tmpdir(), `guideo-flowgraph-emptyerr-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, {
      outputPath,
      ...FAST_LOGIN_WAIT,
      loginErrorSelector: errorSelector,
    });

    await expect(target.discover()).resolves.not.toThrow();

    await rm(outputPath, { force: true });
  });

  // Regression (real e2e): a nav container with real anchors must be used via the anchor fast
  // path — NOT mixed with unscoped page buttons (the old `${container} ${listSelector}` only
  // scoped the first comma-alternative, leaking every page button into nav discovery and burning
  // a click+timeout on each). When anchors exist, no non-submit element should ever be clicked.
  it("uses nav anchors and never clicks non-nav buttons when anchors are present", async () => {
    const A_URL = `${BASE_URL}/a`;
    const B_URL = `${BASE_URL}/b`;
    const DEFAULT_ITEM_SEL = "a[href], button, [role='link'], [role='menuitem'], [role='tab']";
    const anchors = [fakeLink({ href: "/a", text: "A" }), fakeLink({ href: "/b", text: "B" })];
    const strayButton = fakeLink({ href: "", text: "Action", testid: "stray-btn" });
    let currentUrl = "";
    const click = vi.fn(async (selector: string) => {
      if (selector === SUBMIT_SELECTOR) currentUrl = HOME_URL;
      // A stray button click must never happen; if it did, it would NOT navigate anyway.
    });
    const page: PatchrightPage = {
      goto: async (url) => {
        currentUrl = url;
      },
      waitForSelector: async () => {},
      fill: async () => {},
      click,
      goBack: async () => {},
      url: () => currentUrl,
      title: async () => "Home",
      $$: async (selector: string) => {
        const onHome = normalize(currentUrl) === normalize(HOME_URL);
        if (!onHome) return [];
        if (selector === "nav a[href]") return anchors; // fixed anchor-first path
        if (selector === `nav ${DEFAULT_ITEM_SEL}`) return [...anchors, strayButton]; // old leaky path
        if (selector === "a[href]") return anchors;
        return [];
      },
      close: async () => {},
    };
    const browser: PatchrightBrowser = { newPage: async () => page, close: async () => {} };
    const launcher: BrowserLauncher = async () => browser;
    const outputPath = join(tmpdir(), `guideo-flowgraph-anchorpref-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, {
      outputPath,
      ...FAST_LOGIN_WAIT,
      navClickTimeoutMs: 50,
      navPollIntervalMs: 10,
    });

    const graph = await target.discover();

    expect(click).not.toHaveBeenCalledWith('[data-testid="stray-btn"]');
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(A_URL));
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(B_URL));

    await rm(outputPath, { force: true });
  });

  // --- Self-healing discovery: retry nav queries on execution-context-destroyed races -------
  // (v2 sub-project 1 — see docs/superpowers/specs/2026-07-27-guideo-v2-timeline-effects-design.md
  // section E). Real e2e: a client-rendered SPA can trigger a late redirect right after goto()
  // settles, destroying the execution context the very next `page.$$` call reads from —
  // intermittent (failed once, succeeded on retry, live).

  it("retries the nav-item query once after an 'Execution context was destroyed' race, then completes discovery", async () => {
    const { launcher, page } = fakeSite({
      [normalize(HOME_URL)]: {
        title: "Home",
        links: [{ href: "/settings", text: "Settings" }],
      },
      [normalize(`${BASE_URL}/settings`)]: { title: "Settings", links: [] },
    });
    const realQuery = page.$$;
    let thrown = false;
    page.$$ = vi.fn(async (selector: string) => {
      if (!thrown) {
        thrown = true;
        throw new Error("Execution context was destroyed, most likely because of a navigation.");
      }
      return realQuery(selector);
    });
    const outputPath = join(tmpdir(), `guideo-flowgraph-retry-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, {
      outputPath,
      maxPages: 10,
      navQueryRetries: 2,
      navQueryRetryWaitMs: 1,
    });

    const graph = await target.discover();

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

  it("bounds retries and gives up cleanly (no infinite loop) when nav queries always throw the context-destroyed error", async () => {
    const { launcher, page } = fakeSite({
      [normalize(HOME_URL)]: {
        title: "Home",
        links: [{ href: "/settings", text: "Settings" }],
      },
    });
    let callCount = 0;
    page.$$ = vi.fn(async () => {
      callCount++;
      throw new Error("Execution context was destroyed, most likely because of a navigation.");
    });
    const outputPath = join(tmpdir(), `guideo-flowgraph-retry-exhausted-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, {
      outputPath,
      maxPages: 10,
      navQueryRetries: 2,
      navQueryRetryWaitMs: 1,
    });

    const graph = await target.discover();

    expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(HOME_URL));
    expect(graph.edges).toHaveLength(0);
    // Exactly navQueryRetries + 1 attempts (1 initial + 2 retries) — proves the budget is bounded,
    // not an infinite loop.
    expect(callCount).toBe(3);

    await rm(outputPath, { force: true });
  });

  // --- Defect 2: hydration-aware login + SPA-aware nav discovery ---------------------------

  it("waits for the login form (password field) before filling it — hydration-aware login", async () => {
    const callOrder: string[] = [];
    let currentUrl = "";
    const page: PatchrightPage = {
      goto: async (url) => {
        currentUrl = url;
        callOrder.push("goto");
      },
      waitForSelector: async () => {
        callOrder.push("waitForSelector");
      },
      fill: async (selector) => {
        callOrder.push(`fill:${selector}`);
      },
      click: async (selector) => {
        if (selector === SUBMIT_SELECTOR) currentUrl = HOME_URL;
        callOrder.push(`click:${selector}`);
      },
      goBack: async () => {},
      url: () => currentUrl,
      title: async () => "Home",
      $$: async () => [],
      close: async () => {},
    };
    const browser: PatchrightBrowser = { newPage: async () => page, close: async () => {} };
    const launcher: BrowserLauncher = async () => browser;
    const outputPath = join(tmpdir(), `guideo-flowgraph-hydration-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, { outputPath });

    await target.discover();

    const waitIndex = callOrder.indexOf("waitForSelector");
    const firstFillIndex = callOrder.findIndex((entry) => entry.startsWith("fill:"));
    expect(waitIndex).toBeGreaterThanOrEqual(0);
    expect(firstFillIndex).toBeGreaterThan(waitIndex);

    await rm(outputPath, { force: true });
  });

  it("discovers SPA routes reachable only via clickable nav buttons (no <a href> anywhere)", async () => {
    const { launcher, REPORTS_URL, SETTINGS_URL } = fakeSpaButtonNavSite();
    const outputPath = join(tmpdir(), `guideo-flowgraph-spa-${Date.now()}.json`);
    const target = new UrlCredsTarget(launcher, {
      outputPath,
      maxPages: 10,
      navContainerSelectors: ["nav"],
      navItemSelector: "[data-nav-btn]",
      ...FAST_LOGIN_WAIT,
    });

    const graph = await target.discover();

    expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(HOME_URL));
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(REPORTS_URL));
    expect(graph.nodes.map((n) => n.id)).toContain(normalize(SETTINGS_URL));
    expect(graph.edges).toContainEqual({
      from: normalize(HOME_URL),
      to: normalize(REPORTS_URL),
      action: expect.stringContaining("click"),
    });
    expect(graph.edges).toContainEqual({
      from: normalize(HOME_URL),
      to: normalize(SETTINGS_URL),
      action: expect.stringContaining("click"),
    });

    await rm(outputPath, { force: true });
  });
});

// patchright (the undetected Playwright fork used for capture/replay) DISABLES the accessibility
// tree, so `role=`/getByRole selectors match ZERO elements on a real page (verified live against
// camtom-webapp.vercel.app). buildRobustSelector must therefore emit only CSS/DOM selectors.
describe("buildRobustSelector", () => {
  it("prefers data-testid over every other attribute", async () => {
    const selector = await buildRobustSelector(
      fakeLink({ href: "/x", id: "nav-1", text: "Ignored", testid: "nav-dashboard" }),
    );
    expect(selector).toBe('[data-testid="nav-dashboard"]');
  });

  it("falls back to an id selector when no data-testid is present", async () => {
    const selector = await buildRobustSelector(
      fakeLink({ href: "/x", id: "nav-settings", text: "Ignored" }),
    );
    expect(selector).toBe("#nav-settings");
  });

  it("falls back to the raw href as a CSS attribute selector when no testid or id is present", async () => {
    const selector = await buildRobustSelector(fakeLink({ href: "/x", text: "Dashboard" }));
    expect(selector).toBe('a[href="/x"]');
  });

  it("falls back to a DOM text-engine selector for a non-anchor item with no href", async () => {
    const selector = await buildRobustSelector(fakeLink({ href: "", text: "Reports" }));
    expect(selector).toBe('text="Reports"');
  });

  it("falls back to a bare tag selector when no identifying attribute is present", async () => {
    expect(await buildRobustSelector(fakeLink({ href: "" }))).toBe("button");

    // An anchor with a present-but-empty href attribute (real getAttribute returns "", not null)
    // still falls back to the "a" tag, not "button".
    const emptyHrefAnchor: PatchrightElementHandle = {
      getAttribute: async (name) => (name === "href" ? "" : null),
      textContent: async () => null,
    };
    expect(await buildRobustSelector(emptyHrefAnchor)).toBe("a");
  });

  it("never emits a role= selector", async () => {
    const specs: FakeLinkSpec[] = [
      { href: "/x", testid: "nav-dashboard", text: "Dashboard" },
      { href: "/x", id: "nav-settings", text: "Settings" },
      { href: "/x", text: "Dashboard" },
      { href: "", text: "Reports" },
      { href: "" },
    ];
    for (const spec of specs) {
      const selector = await buildRobustSelector(fakeLink(spec));
      expect(selector).not.toMatch(/^role=/);
    }
  });
});
