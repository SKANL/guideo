import { join } from "node:path";

// Where the CLI persists intermediate artifacts between commands: discover's flow-graph.json,
// plan's script.json/storyboard.json (which render then reads back), and render's final video.
// Project-scoped: every path lives under .guideo/projects/<project>/ so multiple targets/briefs
// never collide (see docs/superpowers/specs/2026-07-27-guideo-v2-timeline-effects-design.md,
// section D — this sub-project keeps it simple: one working set per project, no per-brief slugs
// yet). Overridable per-call (tests point cwd at a scratch directory) so no command hardcodes a
// path itself.
export interface GuideoPaths {
  readonly guideoDir: string;
  readonly flowGraphPath: string;
  readonly flowGraphCachePath: string;
  readonly capabilityProfilePath: string;
  readonly scriptPath: string;
  readonly storyboardPath: string;
  readonly approvalManifestPath: string;
  readonly captionsPath: string;
  // STABLE — fixes the previous "final video written to an OS temp dir" bug (compose adapter no
  // longer picks its own path).
  readonly outputPath: string;
}

export function projectPaths(opts: {
  readonly project: string;
  readonly platform?: string;
  readonly cwd?: string;
}): GuideoPaths {
  const cwd = opts.cwd ?? process.cwd();
  // ponytail: only YouTubeProfile is wired end-to-end today (see brief.ts), so "youtube" is a safe
  // default for the output filename when no platform is known yet (e.g. render, which doesn't
  // re-parse the brief). Upgrade when a second PlatformProfile adapter lands.
  const platform = opts.platform ?? "youtube";
  const guideoDir = join(cwd, ".guideo", "projects", opts.project);
  return {
    guideoDir,
    flowGraphPath: join(guideoDir, "flow-graph.json"),
    flowGraphCachePath: join(guideoDir, "flow-graph-cache.json"),
    capabilityProfilePath: join(guideoDir, "capability-profile.json"),
    scriptPath: join(guideoDir, "script.json"),
    storyboardPath: join(guideoDir, "storyboard.json"),
    approvalManifestPath: join(guideoDir, "approval-manifest.json"),
    captionsPath: join(guideoDir, "captions.srt"),
    outputPath: join(guideoDir, "output", `${platform}.mp4`),
  };
}
