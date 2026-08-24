import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface LocalRenderFixture {
  readonly targetUrl: string;
  readonly recordingPath: string;
  readonly captionsPath: string;
}

/** A login-free target and deterministic artifact locations for local physical render checks. */
export function localRenderFixture(cwd: string = process.cwd()): LocalRenderFixture {
  return {
    targetUrl: pathToFileURL(resolve(cwd, "tests/fixtures/physical-render/target.html")).href,
    recordingPath: resolve(cwd, ".guideo/fixtures/local-render.mp4"),
    captionsPath: resolve(cwd, ".guideo/fixtures/local-render.srt"),
  };
}
