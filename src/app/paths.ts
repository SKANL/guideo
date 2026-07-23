import { join } from "node:path";

// Where the CLI persists intermediate artifacts between commands: discover's flow-graph.json,
// plan's script.json/storyboard.json (which render then reads back). Overridable per-call (tests
// point this at a scratch directory) so no command hardcodes a path itself.
export interface GuideoPaths {
  readonly guideoDir: string;
  readonly flowGraphPath: string;
  readonly scriptPath: string;
  readonly storyboardPath: string;
}

export function defaultPaths(cwd: string = process.cwd()): GuideoPaths {
  const guideoDir = join(cwd, ".guideo");
  return {
    guideoDir,
    flowGraphPath: join(guideoDir, "flow-graph.json"),
    scriptPath: join(guideoDir, "script.json"),
    storyboardPath: join(guideoDir, "storyboard.json"),
  };
}
