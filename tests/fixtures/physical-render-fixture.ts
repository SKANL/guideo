import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Stable local target and output names; no authenticated external site is part of this harness. */
export const physicalRenderFixtureTargetPath = fileURLToPath(new URL("./physical-render-target/index.html", import.meta.url));

export function physicalRenderFixtureRecordingPath(root: string): string {
  return join(root, "physical-render-fixture.mp4");
}
