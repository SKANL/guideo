import { parseArgs } from "node:util";
import { parseBrief } from "../domain/models/brief.js";
import { runDiscover } from "./commands/discover.js";
import { runPlan } from "./commands/plan.js";
import { runRender } from "./commands/render.js";
import type { Container } from "./factory.js";
import { projectPaths } from "./paths.js";
import { defaultProjectName } from "./project-name.js";
import { formatReview } from "./review-format.js";

export const USAGE = `Guideo — generate a walkthrough demo video from a URL + credentials.

Usage:
  guideo discover [--project <name>]              Discover the target app, write its flow graph
  guideo plan --brief "<idea>" [--platform youtube] [--project <name>]
                                                   Plan a script + storyboard, then STOP for review
  guideo render --approve [--project <name>]      Render the last-planned, approved storyboard
  guideo --help                                   Show this help

Review gate: "plan" never captures the screen or synthesizes voice. Review the printed script +
storyboard (and the files written under .guideo/), then run "guideo render --approve" only once
you approve. "guideo render" without --approve always refuses — no capture or voice synthesis.

Projects: every command operates on one project's artifacts, stored under
.guideo/projects/<project>/. --project defaults to a slug of GUIDEO_TARGET_URL's host (or
"default" if that env var is unset) — pass --project explicitly to keep multiple targets/briefs
isolated from each other.

Environment (.env, loaded via \`node --env-file=.env\`):
  GUIDEO_TARGET_URL, GUIDEO_TARGET_USERNAME, GUIDEO_TARGET_PASSWORD   required for discover/plan
  ELEVENLABS_API_KEY                                                 required for render
  GUIDEO_FFMPEG_PATH                                                 optional ffmpeg override
`;

function resolveProject(explicit: string | undefined): string {
  return explicit ?? defaultProjectName(process.env.GUIDEO_TARGET_URL);
}

function parseDiscoverArgs(args: readonly string[]): { project: string } {
  const { values } = parseArgs({
    args: [...args],
    options: { project: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  return { project: resolveProject(values.project) };
}

function parsePlanArgs(args: readonly string[]): {
  idea: string;
  platform: string;
  project: string;
} {
  const { values } = parseArgs({
    args: [...args],
    options: {
      brief: { type: "string" },
      platform: { type: "string" },
      project: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.brief) {
    throw new Error(
      'guideo plan requires --brief "<idea>" (e.g. --brief "show how to invite a teammate").',
    );
  }
  return {
    idea: values.brief,
    platform: values.platform ?? "youtube",
    project: resolveProject(values.project),
  };
}

function parseRenderArgs(args: readonly string[]): { approve: boolean; project: string } {
  const { values } = parseArgs({
    args: [...args],
    options: { approve: { type: "boolean" }, project: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  return { approve: values.approve ?? false, project: resolveProject(values.project) };
}

// The testable dispatcher: command parsing + calling into the commands/ layer. Every side effect
// (adapter construction, process.argv, process.exitCode) lives outside this function — cli.ts is
// the only untested process shell, this is fully unit-tested with an injected Container and I/O
// sinks.
export async function runCli(
  argv: readonly string[],
  container: Container,
  cwd: string = process.cwd(),
  print: (line: string) => void = console.log,
  printErr: (line: string) => void = console.error,
): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    print(USAGE);
    return 0;
  }

  try {
    switch (command) {
      case "discover": {
        const { project } = parseDiscoverArgs(rest);
        const paths = projectPaths({ project, cwd });
        const { path } = await runDiscover(container, paths);
        print(`Flow graph discovered and written to ${path}`);
        return 0;
      }
      case "plan": {
        const { idea, platform, project } = parsePlanArgs(rest);
        const brief = parseBrief({ idea, targetPlatform: platform });
        const paths = projectPaths({ project, cwd });
        const { script, storyboard } = await runPlan(container, brief, paths);
        print(formatReview(script, storyboard));
        return 0;
      }
      case "render": {
        const { approve, project } = parseRenderArgs(rest);
        const paths = projectPaths({ project, cwd });
        const video = await runRender(container, approve, paths);
        print(`Final video written to ${video.path}`);
        return 0;
      }
      default: {
        printErr(`Unknown command "${command}".\n\n${USAGE}`);
        return 1;
      }
    }
  } catch (error) {
    printErr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
