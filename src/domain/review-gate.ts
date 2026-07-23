import type { ApprovedStoryboard, Storyboard } from "./models/storyboard.js";

export type ReviewDecision =
  | { readonly kind: "approved" }
  | { readonly kind: "rejected"; readonly reason?: string };

// This module is the ONLY place in the domain permitted to mint an ApprovedStoryboard — the
// brand cast lives here and nowhere else (see models/storyboard.ts's unexported brand symbol).
// Adapters (e.g. CliReviewGate, Phase 4) capture the human decision and call this function; they
// never construct ApprovedStoryboard themselves. Rejection returns null: no mint, pipeline halts.
export function review(
  storyboard: Storyboard,
  decision: ReviewDecision,
): ApprovedStoryboard | null {
  if (decision.kind === "approved") {
    return storyboard as ApprovedStoryboard;
  }
  return null;
}
