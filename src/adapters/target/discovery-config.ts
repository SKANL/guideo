import { join } from "node:path";
import { DEFAULT_LOGIN_CONFIG, type LoginConfig } from "./login.js";

// Non-secret discovery knobs — tunable per-instance via UrlCredsTarget's constructor. Credentials
// (URL/username/password) are NOT here: those are secrets and stay env-only, read lazily inside
// discover() — see url-creds-target.ts. Extends LoginConfig (shared with capture's WebRecordingEngine
// — see login.ts) with discovery-only crawl knobs.
export interface DiscoveryConfig extends LoginConfig {
  // ponytail: bounded crawl — a flat visited-page-count ceiling, not a smart/relevance-ranked
  // frontier. Enough to map one real flow for the thin slice; raise it (or replace with a
  // priority frontier) once discovery needs to cover a larger app.
  readonly maxPages: number;
  // Where the FlowGraph JSON is persisted. Re-running discover() overwrites this file.
  readonly outputPath: string;
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
  ...DEFAULT_LOGIN_CONFIG,
  maxPages: 20,
  outputPath: join(process.cwd(), ".guideo", "flow-graph.json"),
  navContainerSelectors: ["nav", "aside", "[role='navigation']", "[data-testid='sidebar']"],
  navItemSelector: "a[href], button, [role='link'], [role='menuitem'], [role='tab']",
  navClickTimeoutMs: 3_000,
  navPollIntervalMs: 200,
};
