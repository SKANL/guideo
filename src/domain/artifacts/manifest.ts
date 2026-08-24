import { sha256 } from "./canonical.js";
export interface ArtifactRef { readonly schema: string; readonly version: number; readonly sha256: string; }
export interface ArtifactManifest extends ArtifactRef { readonly inputs: Readonly<Record<string, string>>; readonly finalized?: boolean; }
export type ApprovalInputs = Readonly<{ flowGraph: string; script: string; storyboard: string; policy: string }>;
export function artifactManifest(schema: string, version: number, inputs: Readonly<Record<string, string>>): ArtifactManifest { return Object.freeze({ schema, version, inputs: Object.freeze({ ...inputs }), sha256: sha256({ schema, version, inputs }) }); }
export function approvalManifest(inputs: ApprovalInputs): ArtifactManifest { return artifactManifest("approval", 2, inputs); }
