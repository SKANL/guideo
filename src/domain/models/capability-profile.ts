import { sha256 } from "../artifacts/canonical.js";
import type { FlowGraph } from "./flow-graph.js";

export const CAPABILITY_PROFILE_SCHEMA = "target-capability-profile";
export const CAPABILITY_PROFILE_VERSION = 1;

export interface CapabilityFingerprints {
  readonly url: string;
  readonly build: string;
  readonly content: string;
}

export interface CapabilityProfile {
  readonly schema: typeof CAPABILITY_PROFILE_SCHEMA;
  readonly version: typeof CAPABILITY_PROFILE_VERSION;
  readonly graphSha256: string;
  readonly loginSelectors: Readonly<Record<string, string>>;
  readonly semanticLocators: Readonly<Record<string, readonly string[]>>;
  readonly routes: readonly string[];
  readonly fingerprints: CapabilityFingerprints;
}

export interface DiscoveryFingerprint extends Partial<CapabilityFingerprints> {
  readonly loginSelectors?: Readonly<Record<string, string>>;
}

export function deriveCapabilityProfile(
  graph: FlowGraph,
  fingerprint: DiscoveryFingerprint = {},
): CapabilityProfile {
  const loginSelectors: Record<string, string> = { ...(fingerprint.loginSelectors ?? {}) };
  const semanticLocators: Record<string, string[]> = {};
  const routes = graph.nodes.map((node) => node.id).sort(compareStableStrings);

  for (const node of graph.nodes) {
    for (const [name, selector] of Object.entries(node.selectors)) {
      if (/login|user|email|password|submit/i.test(name)) loginSelectors[name] ??= selector;
    }
    const candidates = node.locatorEvidence?.candidates ?? Object.values(node.selectors);
    semanticLocators[node.id] = [...new Set(candidates)].sort(compareStableStrings);
  }

  const evidence = graph.nodes.map((node) => ({
    route: node.id,
    url: node.locatorEvidence?.urlFingerprint,
    build: node.locatorEvidence?.buildFingerprint,
    content: node.locatorEvidence?.stateFingerprint,
  }));
  const fingerprints: CapabilityFingerprints = {
    url:
      fingerprint.url ??
      sha256({ routes, evidence: evidence.map(({ route, url }) => ({ route, url })) }),
    build:
      fingerprint.build ??
      sha256({ evidence: evidence.map(({ route, build }) => ({ route, build })) }),
    content:
      fingerprint.content ??
      sha256({ evidence: evidence.map(({ route, content }) => ({ route, content })) }),
  };

  return {
    schema: CAPABILITY_PROFILE_SCHEMA,
    version: CAPABILITY_PROFILE_VERSION,
    graphSha256: sha256(graph),
    loginSelectors,
    semanticLocators,
    routes,
    fingerprints,
  };
}

export function isCapabilityProfile(value: unknown): value is CapabilityProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<CapabilityProfile>;
  return (
    profile.schema === CAPABILITY_PROFILE_SCHEMA &&
    profile.version === CAPABILITY_PROFILE_VERSION &&
    typeof profile.graphSha256 === "string" &&
    Array.isArray(profile.routes) &&
    !!profile.fingerprints &&
    typeof profile.fingerprints.url === "string" &&
    typeof profile.fingerprints.build === "string" &&
    typeof profile.fingerprints.content === "string"
  );
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
