import { join } from "node:path";

// Non-secret discovery knobs — tunable per-instance via UrlCredsTarget's constructor. Credentials
// (URL/username/password) are NOT here: those are secrets and stay env-only, read lazily inside
// discover() — see url-creds-target.ts.
export interface DiscoveryConfig {
  // ponytail: bounded crawl — a flat visited-page-count ceiling, not a smart/relevance-ranked
  // frontier. Enough to map one real flow for the thin slice; raise it (or replace with a
  // priority frontier) once discovery needs to cover a larger app.
  readonly maxPages: number;
  // Where the FlowGraph JSON is persisted. Re-running discover() overwrites this file.
  readonly outputPath: string;
  // ponytail: heuristic login-form selectors — good enough for common login forms, not a
  // guarantee for every target app's markup. A future upgrade could probe multiple candidate
  // selectors or accept an app-specific override.
  readonly usernameSelector: string;
  readonly passwordSelector: string;
  readonly submitSelector: string;
  // How goto() waits for a navigation to settle. Client-rendered SPAs need "networkidle" (or at
  // least "load") — "domcontentloaded" fires before hydration and leaves the DOM empty.
  readonly gotoWaitUntil: "load" | "domcontentloaded" | "networkidle";
  // How long to wait for the login form (passwordSelector) to exist before filling it —
  // hydration-aware login for SPAs that render the form after JS boots.
  readonly formWaitTimeoutMs: number;
  // How long to wait, after submitting login, for the post-login transition (URL change away
  // from the login route) before declaring the login attempt failed.
  readonly loginTimeoutMs: number;
  readonly loginPollIntervalMs: number;
  // ponytail: heuristic auth-error banner selector — matches common patterns (role=alert,
  // data-testid, .error-ish class names), not a guarantee for every target app's markup. If it
  // matches while still on the login route, discover() fails loudly instead of silently
  // proceeding. A future upgrade could accept an app-specific override.
  readonly loginErrorSelector: string;
  // Candidate primary-navigation container selectors, tried in order; the first one whose
  // combined `container navItemSelector` query returns elements wins. Falls back to
  // `navItemSelector` alone (whole-document) if none match — covers apps with no nav wrapper.
  readonly navContainerSelectors: readonly string[];
  // Clickable nav-item selector: anchors AND buttons AND common ARIA link/menu/tab roles —
  // SPA navigation is frequently button/router-driven, not `<a href>`-only.
  readonly navItemSelector: string;
  // How long to wait, after clicking a non-anchor nav item, for the URL to change before
  // concluding it wasn't a navigation control (e.g. a toggle/dropdown) and skipping it.
  readonly navClickTimeoutMs: number;
  readonly navPollIntervalMs: number;
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  maxPages: 20,
  outputPath: join(process.cwd(), ".guideo", "flow-graph.json"),
  usernameSelector: 'input[type="email"], input[name="username"], input[name="email"]',
  passwordSelector: 'input[type="password"]',
  submitSelector: 'button[type="submit"]',
  gotoWaitUntil: "networkidle",
  formWaitTimeoutMs: 15_000,
  loginTimeoutMs: 15_000,
  loginPollIntervalMs: 250,
  loginErrorSelector:
    '[role="alert"], [data-testid="auth-error"], .error, .alert-error, [class*="error"]',
  navContainerSelectors: ["nav", "aside", "[role='navigation']", "[data-testid='sidebar']"],
  navItemSelector: "a[href], button, [role='link'], [role='menuitem'], [role='tab']",
  navClickTimeoutMs: 8_000,
  navPollIntervalMs: 200,
};
