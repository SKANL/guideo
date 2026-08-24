import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffprobeStatic = require("ffprobe-static") as { readonly path?: unknown };
const bundledFfprobePath = typeof ffprobeStatic.path === "string" ? ffprobeStatic.path : null;

/** Resolves ffprobe deterministically before accepting a PATH-provided installation. */
export function resolveFfprobePath(
  env: NodeJS.ProcessEnv = process.env,
  bundledPath: string | null = bundledFfprobePath,
): string {
  if (env.GUIDEO_FFPROBE_PATH) return env.GUIDEO_FFPROBE_PATH;
  if (bundledPath) return bundledPath;
  if (env.PATH) return "ffprobe";
  throw new Error(
    "Unable to resolve ffprobe: set GUIDEO_FFPROBE_PATH, install the bundled ffprobe-static dependency, or provide ffprobe on PATH.",
  );
}
