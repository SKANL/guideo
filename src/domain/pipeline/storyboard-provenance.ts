import type { FlowGraphRoutes } from "../ports/script-gen.js";
import { isSelectorRequiredAction, type Storyboard } from "../models/storyboard.js";

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

    const locatorCandidates = [
      ...new Set([
        ...(node.locatorEvidence?.candidates ?? []),
        ...Object.values(node.selectors),
      ]),
    ].sort();
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
