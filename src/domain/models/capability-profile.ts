import { sha256 } from "../artifacts/canonical.js";
import { normalizeFlowGraph, type FlowGraph } from "./flow-graph.js";

export const CAPABILITY_PROFILE_SCHEMA = "target-capability-profile";
export const CAPABILITY_PROFILE_VERSION = 2;

export interface CapabilityFingerprints {
  readonly url: string;
  readonly build: string;
  readonly content: string;
}

export interface CapabilityProfile {
  readonly schema: typeof CAPABILITY_PROFILE_SCHEMA;
  readonly version: typeof CAPABILITY_PROFILE_VERSION;
  readonly graphSha256: string;
  readonly targetSignature: string;
  readonly loginSelectors: Readonly<Record<string, string>>;
  readonly semanticLocators: Readonly<Record<string, readonly string[]>>;
  readonly routes: readonly string[];
  readonly fingerprints: CapabilityFingerprints;
  readonly evidence: Readonly<Record<string, SemanticTargetEvidence>>;
  readonly states: Readonly<Record<string, string>>;
  readonly postconditions: Readonly<Record<string, readonly CapabilityPostcondition[]>>;
  readonly observationPlan: readonly ObservationPlanPage[];
}

export interface SemanticTargetEvidence {
  readonly role?: string;
  readonly name?: string;
  readonly label?: string;
  readonly testId?: string;
  readonly locatorCandidates: readonly string[];
  readonly semanticTarget?: {
    readonly role?: string;
    readonly accessibleName?: string;
    readonly label?: string;
    readonly testId?: string;
  };
  readonly postcondition?: { readonly selector?: string; readonly evidence: string };
  readonly layoutOccupancy?: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  readonly safeCaptionRegions?: readonly ("lower-third" | "top" | "bottom-left" | "bottom-right")[];
  readonly confidence?: "low" | "medium" | "high";
  readonly evidenceRefs?: readonly string[];
}

export interface CapabilityPostcondition {
  readonly from: string;
  readonly action: string;
}

export interface ObservationPlanPage {
  readonly route: string;
  readonly reason: "new-route" | "state-changed";
}

export interface DiscoveryFingerprint extends Partial<CapabilityFingerprints> {
  readonly loginSelectors?: Readonly<Record<string, string>>;
}

export function deriveCapabilityProfile(
  graph: FlowGraph,
  fingerprint: DiscoveryFingerprint = {},
  previousProfile?: CapabilityProfile,
): CapabilityProfile {
  const normalizedGraph = normalizeFlowGraph(graph);
  const suppliedNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const loginSelectors: Record<string, string> = { ...(fingerprint.loginSelectors ?? {}) };
  const semanticLocators: Record<string, string[]> = {};
  const evidence: Record<string, SemanticTargetEvidence> = {};
  const states: Record<string, string> = {};
  const postconditions: Record<string, CapabilityPostcondition[]> = {};
  const routes = normalizedGraph.nodes.map((node) => node.id).sort(compareStableStrings);

  for (const node of normalizedGraph.nodes) {
    for (const [name, selector] of Object.entries(node.selectors)) {
      if (/login|user|email|password|submit/i.test(name)) loginSelectors[name] ??= selector;
    }
    const candidates = suppliedNodes.get(node.id)?.locatorEvidence?.candidates
      ?? node.locatorEvidence?.candidates
      ?? Object.values(node.selectors);
    semanticLocators[node.id] = [...new Set(candidates)].sort(compareStableStrings);
    evidence[node.id] = semanticEvidence(
      node.selectors,
      semanticLocators[node.id]!,
      suppliedNodes.get(node.id)?.locatorEvidence ?? node.locatorEvidence,
    );
    states[node.id] = node.locatorEvidence?.stateFingerprint ?? sha256({
      route: node.id,
      selectors: node.selectors,
    });
    postconditions[node.id] = [];
  }

  for (const edge of normalizedGraph.edges) {
    (postconditions[edge.to] ??= []).push({ from: edge.from, action: edge.action });
  }
  for (const conditions of Object.values(postconditions)) {
    conditions.sort((left, right) => compareStableStrings(
      `${left.from}\u0000${left.action}`,
      `${right.from}\u0000${right.action}`,
    ));
  }

  const fingerprintEvidence = normalizedGraph.nodes.map((node) => ({
    route: node.id,
    url: node.locatorEvidence?.urlFingerprint,
    build: node.locatorEvidence?.buildFingerprint,
    content: node.locatorEvidence?.stateFingerprint,
  }));
  const fingerprints: CapabilityFingerprints = {
    url:
      fingerprint.url ??
      sha256({ routes, evidence: fingerprintEvidence.map(({ route, url }) => ({ route, url })) }),
    build:
      fingerprint.build ??
      sha256({ evidence: fingerprintEvidence.map(({ route, build }) => ({ route, build })) }),
    content:
      fingerprint.content ??
      sha256({ evidence: fingerprintEvidence.map(({ route, content }) => ({ route, content })) }),
  };
  const targetSignature = sha256({ fingerprints, loginSelectors });
  const observationPlan = routes
    .flatMap((route): ObservationPlanPage[] => {
      if (!previousProfile || !(route in previousProfile.states)) {
        return [{ route, reason: "new-route" }];
      }
      return previousProfile.states[route] === states[route]
        ? []
        : [{ route, reason: "state-changed" }];
    });

  return {
    schema: CAPABILITY_PROFILE_SCHEMA,
    version: CAPABILITY_PROFILE_VERSION,
    graphSha256: sha256(normalizedGraph),
    targetSignature,
    loginSelectors,
    semanticLocators,
    routes,
    fingerprints,
    evidence,
    states,
    postconditions,
    observationPlan,
  };
}

export function isCapabilityProfile(value: unknown): value is CapabilityProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<CapabilityProfile>;
  return (
    profile.schema === CAPABILITY_PROFILE_SCHEMA &&
    profile.version === CAPABILITY_PROFILE_VERSION &&
    typeof profile.graphSha256 === "string" &&
    typeof profile.targetSignature === "string" &&
    Array.isArray(profile.routes) &&
    !!profile.fingerprints &&
    typeof profile.fingerprints.url === "string" &&
    typeof profile.fingerprints.build === "string" &&
    typeof profile.fingerprints.content === "string"
    && !!profile.evidence
    && !!profile.states
    && !!profile.postconditions
    && Array.isArray(profile.observationPlan)
  );
}

function semanticEvidence(
  selectors: Readonly<Record<string, string>>,
  locatorCandidates: readonly string[],
  suppliedEvidence: FlowGraph["nodes"][number]["locatorEvidence"],
): SemanticTargetEvidence {
  const [label, selector = ""] = Object.entries(selectors)
    .filter(([, value]) => locatorCandidates.includes(value))
    .sort(([left], [right]) => compareStableStrings(left, right))[0] ?? [];
  const testId = /data-testid=["']?([^\]"']+)/.exec(selector)?.[1];
  const role = /^a(?:[\[.#]|$)/.test(selector)
    ? "link"
    : /^(button|\[role=["']?button)/.test(selector)
      ? "button"
      : undefined;
  const semanticTarget = suppliedEvidence?.semanticTarget === undefined
    ? {
        ...(role === undefined ? {} : { role }),
        ...(selector.startsWith("text=") ? { accessibleName: selector.slice("text=".length) } : {}),
        ...(label === undefined ? {} : { label }),
        ...(testId === undefined ? {} : { testId }),
      }
    : {
        ...(suppliedEvidence.semanticTarget.role === undefined ? {} : { role: suppliedEvidence.semanticTarget.role }),
        ...(suppliedEvidence.semanticTarget.accessibleName === undefined
          ? {}
          : { accessibleName: suppliedEvidence.semanticTarget.accessibleName }),
        ...(suppliedEvidence.semanticTarget.label === undefined ? {} : { label: suppliedEvidence.semanticTarget.label }),
        ...(suppliedEvidence.semanticTarget.testId === undefined ? {} : { testId: suppliedEvidence.semanticTarget.testId }),
      };
  const postcondition = suppliedEvidence?.postcondition === undefined
    ? undefined
    : {
        ...(suppliedEvidence.postcondition.selector === undefined
          ? {}
          : { selector: suppliedEvidence.postcondition.selector }),
        evidence: suppliedEvidence.postcondition.evidence,
      };
  return {
    ...(role === undefined ? {} : { role }),
    ...(selector.startsWith("text=") ? { name: selector.slice("text=".length) } : {}),
    ...(label === undefined ? {} : { label }),
    ...(testId === undefined ? {} : { testId }),
    locatorCandidates,
    ...(Object.keys(semanticTarget).length === 0 ? {} : { semanticTarget }),
    ...(postcondition === undefined ? {} : { postcondition }),
    ...(suppliedEvidence?.layoutOccupancy?.length ? { layoutOccupancy: suppliedEvidence.layoutOccupancy } : {}),
    ...(suppliedEvidence?.safeCaptionRegions?.length ? { safeCaptionRegions: suppliedEvidence.safeCaptionRegions } : {}),
    ...(suppliedEvidence?.confidence === undefined ? {} : { confidence: suppliedEvidence.confidence }),
    ...(suppliedEvidence?.evidenceRefs?.length ? { evidenceRefs: suppliedEvidence.evidenceRefs } : {}),
  };
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
