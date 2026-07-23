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
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  maxPages: 20,
  outputPath: join(process.cwd(), ".guideo", "flow-graph.json"),
  usernameSelector: 'input[type="email"], input[name="username"], input[name="email"]',
  passwordSelector: 'input[type="password"]',
  submitSelector: 'button[type="submit"]',
};
