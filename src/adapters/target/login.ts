// Shared login logic — the SAME authenticated-session bootstrap used by both discovery
// (UrlCredsTarget) and capture (WebRecordingEngine), so a hard-won fix here benefits every caller
// instead of being re-derived/duplicated per adapter. Extracted from url-creds-target.ts.
//
// Three behaviors here are HARD-WON bug fixes surfaced by real e2e runs (see e2e-findings) —
// preserve them EXACTLY:
//   (a) an empty error container is NOT a failure — only real (non-empty) error text is.
//   (b) success is a URL change away from the ACTUAL post-redirect login URL (page.url() right
//       after goto()), not env.url — env.url may be the app root that redirects to "/login".
//   (c) a stuck/failed login fails loudly (throws), never silently proceeds to crawl/capture.

export type WaitUntil = "load" | "domcontentloaded" | "networkidle";

// Narrow structural subset of patchright's ElementHandle — only what login/discovery read to
// build a robust selector or check error text. A real patchright ElementHandle satisfies this
// structurally; unit tests can pass a plain fake object literal.
export interface PatchrightElementHandle {
  getAttribute(name: string): Promise<string | null>;
  textContent(): Promise<string | null>;
}

// Narrow structural subset of patchright's Page — only what login/discovery call. `goto`/`goBack`
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

// Reads target URL/credentials from env. Called only at discover()/capture()-time (never at
// import or construction) so a missing env produces a clear error exactly when it's attempted.
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
      `readTargetEnvOrThrow() requires env var(s) ${missing.join(", ")}. Load them via ` +
        "`node --env-file=.env` (or export them) before calling discover()/capture().",
    );
  }
  const { url, username, password } = values;
  if (!url || !username || !password) {
    throw new Error("readTargetEnvOrThrow(): unexpected missing env value.");
  }
  return { url, username, password };
}

// Login-relevant knobs — shared by DiscoveryConfig (which extends this) and WebRecordingEngine's
// own config. Tunable per-instance; credentials stay env-only (see readTargetEnvOrThrow).
export interface LoginConfig {
  // ponytail: heuristic login-form selectors — good enough for common login forms, not a
  // guarantee for every target app's markup. A future upgrade could probe multiple candidate
  // selectors or accept an app-specific override.
  readonly usernameSelector: string;
  readonly passwordSelector: string;
  readonly submitSelector: string;
  // How goto() waits for a navigation to settle. Client-rendered SPAs need "networkidle" (or at
  // least "load") — "domcontentloaded" fires before hydration and leaves the DOM empty.
  readonly gotoWaitUntil: WaitUntil;
  // How long to wait for the login form (passwordSelector) to exist before filling it —
  // hydration-aware login for SPAs that render the form after JS boots.
  readonly formWaitTimeoutMs: number;
  // How long to wait, after submitting login, for the post-login transition (URL change away
  // from the login route) before declaring the login attempt failed.
  readonly loginTimeoutMs: number;
  readonly loginPollIntervalMs: number;
  // ponytail: heuristic auth-error banner selector — matches common patterns (role=alert,
  // data-testid, .error-ish class names), not a guarantee for every target app's markup. If it
  // matches while still on the login route, login() fails loudly instead of silently proceeding.
  // A future upgrade could accept an app-specific override.
  readonly loginErrorSelector: string;
}

export const DEFAULT_LOGIN_CONFIG: LoginConfig = {
  usernameSelector: 'input[type="email"], input[name="username"], input[name="email"]',
  passwordSelector: 'input[type="password"]',
  submitSelector: 'button[type="submit"]',
  gotoWaitUntil: "networkidle",
  formWaitTimeoutMs: 15_000,
  loginTimeoutMs: 15_000,
  loginPollIntervalMs: 250,
  // Matched only as a failure signal when the element carries real text (see hasRealError) — an
  // exact-class/role list, deliberately NOT the substring `[class*="error"]` (which also matches
  // "errors"/"no-error"/etc. and invites false positives).
  loginErrorSelector:
    '[role="alert"], [data-testid="auth-error"], .error, .alert-error, .alert-danger',
};

export function resolveLoginConfig(config: LoginConfig): LoginConfig {
  return {
    ...config,
    usernameSelector: process.env.GUIDEO_LOGIN_USERNAME_SELECTOR ?? config.usernameSelector,
    passwordSelector: process.env.GUIDEO_LOGIN_PASSWORD_SELECTOR ?? config.passwordSelector,
    submitSelector: process.env.GUIDEO_LOGIN_SUBMIT_SELECTOR ?? config.submitSelector,
  };
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

// Matches patchright/Playwright's error for the exact race that a client-rendered SPA's late
// navigation/redirect can trigger right after a goto() settles or a click navigates — destroying
// the execution context the very next DOM query/interaction reads from. Shared by discovery
// (UrlCredsTarget's findNavItemsWithRetry) and capture (WebRecordingEngine's self-healing retries)
// — a hard-won fix here benefits both instead of being re-derived/duplicated per adapter.
const EXECUTION_CONTEXT_DESTROYED_RE = /execution context was destroyed|navigation/i;

export function isExecutionContextDestroyedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return EXECUTION_CONTEXT_DESTROYED_RE.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOGIN_FAILED_MESSAGE =
  "Login failed — check GUIDEO_TARGET_USERNAME/PASSWORD; the target reported invalid " +
  "credentials or never left the login page.";

// Hydration-aware: waits for the login form to actually exist (SPAs render it post-JS-boot, so
// filling immediately after goto() would hit an empty DOM) before filling/submitting, then
// verifies the login actually succeeded — no silent proceed on bad creds or a stuck SPA.
export async function login(
  page: PatchrightPage,
  env: UrlCredsEnv,
  config: LoginConfig,
): Promise<void> {
  await page.goto(env.url, { waitUntil: config.gotoWaitUntil });
  await page.waitForSelector(config.passwordSelector, { timeout: config.formWaitTimeoutMs });
  // The ACTUAL login URL after any redirect (env.url may be the app root "/" that redirects to
  // "/login"). Login success is a transition away from THIS url — comparing against env.url would
  // read the initial redirect as an instant false success (real e2e).
  const loginUrl = page.url() || env.url;
  await page.fill(config.usernameSelector, env.username);
  await page.fill(config.passwordSelector, env.password);
  await page.click(config.submitSelector);
  await verifyLoginSucceeded(page, loginUrl, config);
}

// Polls (bounded by loginTimeoutMs) for either an auth-error indicator or a URL change away from
// the login route. Throws a clear, actionable error otherwise — never silently proceeds on a
// failed login (see e2e-findings: was a silent-failure bug producing a useless 2-node graph with
// exit 0).
async function verifyLoginSucceeded(
  page: PatchrightPage,
  loginUrl: string,
  config: LoginConfig,
): Promise<void> {
  const normalizedLoginUrl = normalizeUrl(loginUrl);
  const deadline = Date.now() + config.loginTimeoutMs;

  while (true) {
    // Success takes priority: a URL change away from the login route means we're authenticated.
    const currentUrl = page.url();
    if (currentUrl && normalizeUrl(currentUrl) !== normalizedLoginUrl) return;

    // A failure requires a REAL error — an error element carrying actual text. An always-present
    // empty [role=alert]/aria-live container (common in SPAs) matches the selector but has no
    // text; treating its mere presence as a failure false-positived logins that had actually
    // succeeded (see e2e-findings).
    if (await hasRealError(page, config)) throw new Error(LOGIN_FAILED_MESSAGE);

    if (Date.now() >= deadline) throw new Error(LOGIN_FAILED_MESSAGE);
    await sleep(config.loginPollIntervalMs);
  }
}

// True only if at least one error-selector match carries non-empty text — guards against
// always-present empty alert/aria-live containers that match the selector but signal nothing.
async function hasRealError(page: PatchrightPage, config: LoginConfig): Promise<boolean> {
  try {
    for (const el of await page.$$(config.loginErrorSelector)) {
      if ((await el.textContent())?.trim()) return true;
    }
  } catch (err) {
    // This runs in verifyLoginSucceeded's poll loop right after submit, while the page may be
    // NAVIGATING to the post-login route — patchright then throws "Execution context was destroyed"
    // from `$$`/textContent. That destruction IS the success signal (the page left the login page);
    // swallow it and return "no error" so the URL-change check confirms success on the next poll.
    // Intermittent real-e2e finding: this unwrapped `$$` occasionally crashed a whole render.
    if (!isExecutionContextDestroyedError(err)) throw err;
  }
  return false;
}
