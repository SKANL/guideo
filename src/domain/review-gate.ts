import { artifactManifest, type ArtifactManifest } from "./artifacts/manifest.js";
import type { ApprovedStoryboard, Storyboard } from "./models/storyboard.js";
import type { ApprovalInputs } from "./artifacts/manifest.js";
export type ReviewDecision = { readonly kind: "approved" } | { readonly kind: "rejected"; readonly reason?: string };
export function review(storyboard: Storyboard, decision: ReviewDecision): ApprovedStoryboard | null { return decision.kind === "approved" ? storyboard as ApprovedStoryboard : null; }
export function reviewWithManifest(storyboard: Storyboard, manifest: ArtifactManifest, actual: ApprovalInputs): ApprovedStoryboard | null { const expected = artifactManifest("approval", 2, actual); if (manifest.schema !== "approval" || manifest.version !== 2 || manifest.sha256 !== expected.sha256 || Object.keys(actual).some((key) => manifest.inputs[key] !== actual[key as keyof ApprovalInputs])) throw new Error("approval manifest hash mismatch"); return review(storyboard, { kind: "approved" }); }
