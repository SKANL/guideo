import type { Brief } from "../models/brief.js";
import type { FlowGraphRoutes } from "../ports/script-gen.js";
import { isSelectorRequiredAction, type Storyboard } from "../models/storyboard.js";

const ACTION_ORIENTED_BRIEF_PATTERNS: readonly RegExp[] = [
  /\bhow to\b/i,
  /\bwalk(?:ing)? through\b/i,
  /\b(?:click|type|hover|navigate|sign in|log in|login|add|create|invite|submit|search|filter|select|checkout|purchase|buy|remove|update|edit|delete)\b/i,
];
const EXECUTABLE_ACTIONS = new Set(["navigate", "click", "type", "hover"]);

function isActionOrientedBrief(brief: Brief): boolean {
  return ACTION_ORIENTED_BRIEF_PATTERNS.some((pattern) => pattern.test(brief.idea));
}

function hasDiscoverSelectorEvidence(routes: FlowGraphRoutes): boolean {
  return routes.nodes.some(
    (node) =>
      node.locatorEvidence?.candidates.length || Object.values(node.selectors).length,
  );
}

/**
 * Rejects inert plans only when the brief explicitly asks for an interaction and Discover found
 * relevant executable targets. Explanatory briefs intentionally remain free to use pause-only
 * storyboards.
 */
export function assertStoryboardActionCoverage(
  storyboard: Storyboard,
  routes: FlowGraphRoutes,
  brief: Brief,
): void {
  if (!isActionOrientedBrief(brief)) return;
  if (routes.nodes.length === 0) {
    throw new Error(
      "Action-oriented brief has no relevant discovered routes; refine the brief or run Discover again before planning",
    );
  }
  // Legacy in-memory callers may provide route nodes without locator evidence. Preserve their
  // planning contract; real Discover output always carries evidence and is gated below.
  if (!hasDiscoverSelectorEvidence(routes)) return;
  if (storyboard.steps.some((step) => EXECUTABLE_ACTIONS.has(step.action))) return;

  throw new Error(
    "Action-oriented brief with Discover selector evidence requires at least one executable action (navigate, click, type, or hover)",
  );
}

/**
 * Binds generated actions to the exact locator evidence returned by Discover.
 * This is pure and deliberately does not resolve, invent, or repair selectors.
 */
export function bindStoryboardProvenance(
  storyboard: Storyboard,
  routes: FlowGraphRoutes,
): Storyboard {
  const nodes = [...routes.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const steps = storyboard.steps.map((step, index) => {
    if (!isSelectorRequiredAction(step.action)) return step;
    if (!step.selector) {
      throw new Error(`Generated storyboard step ${index} requires a selector for action "${step.action}"`);
    }
    const selector = step.selector;

    const node = nodes.find((candidate) => {
      const candidates = new Set([
        ...(candidate.locatorEvidence?.candidates ?? []),
        ...Object.values(candidate.selectors),
      ]);
      return candidates.has(selector);
    });
    if (!node) {
      throw new Error(
        `Generated storyboard step ${index} selector "${selector}" is not present in Discover locatorEvidence/selector candidates`,
      );
    }

    // Bind only the selector the planner chose. The node-level candidate list contains every
    // control on the page; passing that whole page inventory to capture makes resolution
    // ambiguous and defeats deterministic replay. Discover membership was already verified above.
    const locatorCandidates = [selector];
    return {
      ...step,
      evidence: {
        ...step.evidence,
        locatorCandidates,
        ...(node.locatorEvidence?.urlFingerprint === undefined
          ? {}
          : { urlFingerprint: node.locatorEvidence.urlFingerprint }),
      },
    };
  });

  return { ...storyboard, steps };
}
