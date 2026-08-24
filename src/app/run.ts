import { parseArgs } from "node:util";
import { join } from "node:path";
import { parseBrief } from "../domain/models/brief.js";
import { parseRenderProfileName } from "../domain/models/media.js";
import { type NarrationMode, parseNarrationMode } from "../domain/models/narration-mode.js";
import { runDiscover } from "./commands/discover.js";
import { runPlan } from "./commands/plan.js";
import { runRender } from "./commands/render.js";
import { runValidateMatrix } from "./commands/validate-matrix.js";
import {
  parseValidateNarration,
  parseValidateRenderProfile,
  runValidate,
} from "./commands/validate.js";
import type { Container } from "./factory.js";
import { projectPaths } from "./paths.js";
import { defaultProjectName } from "./project-name.js";
import { formatReview } from "./review-format.js";

export const USAGE = `Guideo — generate a walkthrough demo video from a URL + credentials.

Usage:
  guideo discover [--project <name>]              Discover the target app, write its flow graph
  guideo plan --brief "<idea>" [--platform youtube] [--project <name>]
                                                   Plan a script + storyboard, then STOP for review
  guideo render --approve [--project <name>] [--narration <voice|subtitles|both|silent>] [--profile <youtube|shorts|square>]
                                                   Render the last-planned, approved storyboard
  guideo validate [--project <name>] [--narration <voice|subtitles|both|silent>] [--profile <youtube|shorts|square>] [--ux-evidence <path>]
                                                   Validate one rendered MP4/SRT and write its reports
  guideo validate-matrix [--project <name>]       Validate all rendered profile/narration variants and write a matrix artifact
  guideo --help                                   Show this help

Review gate: "plan" never captures the screen or synthesizes voice. Review the printed script +
storyboard (and the files written under .guideo/), then run "guideo render --approve" only once
you approve. "guideo render" without --approve always refuses — no capture or voice synthesis.

Narration modes (--narration, default "both"): "voice" synthesizes narration audio; "subtitles"
skips voice synthesis entirely (no TTS spend); "both" does voice audio + subtitles. Every mode
writes a captions.srt sidecar for accessibility; silent remains available for voice-free output.

Projects: every command operates on one project's artifacts, stored under
.guideo/projects/<project>/. --project defaults to a slug of GUIDEO_TARGET_URL's host (or
"default" if that env var is unset) — pass --project explicitly to keep multiple targets/briefs
isolated from each other.

Environment (.env, loaded via \`node --env-file=.env\`):
  GUIDEO_TARGET_URL, GUIDEO_TARGET_USERNAME, GUIDEO_TARGET_PASSWORD   required for discover/plan
  ELEVENLABS_API_KEY                                                 required for render
  GUIDEO_FFMPEG_PATH                                                 optional ffmpeg override
  GUIDEO_FFPROBE_PATH                                                optional ffprobe override
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

function parseRenderArgs(args: readonly string[]): {
  approve: boolean;
  project: string;
  narration: NarrationMode;
  renderProfile: import("../domain/models/media.js").RenderProfileName;
} {
  const { values } = parseArgs({
    args: [...args],
    options: {
      approve: { type: "boolean" },
      project: { type: "string" },
      narration: { type: "string" },
      profile: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    approve: values.approve ?? false,
    project: resolveProject(values.project),
    narration: parseNarrationMode(values.narration ?? "both"),
    renderProfile: parseRenderProfileName(values.profile ?? "youtube"),
  };
}

function parseValidateArgs(args: readonly string[]): {
  project: string;
  narration: NarrationMode;
  renderProfile: import("../domain/models/media.js").RenderProfileName;
  uxEvidencePath?: string;
} {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: "string" },
      narration: { type: "string" },
      profile: { type: "string" },
      "ux-evidence": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    project: resolveProject(values.project),
    narration: parseValidateNarration(values.narration),
    renderProfile: parseValidateRenderProfile(values.profile),
    ...(values["ux-evidence"] ? { uxEvidencePath: values["ux-evidence"] } : {}),
  };
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
        const { approve, project, narration, renderProfile } = parseRenderArgs(rest);
        const paths = projectPaths({ project, cwd, renderProfile, narration });
        const video = await runRender(container, approve, paths, narration, renderProfile);
        print(`Final video written to ${video.path}`);
        return 0;
      }
      case "validate": {
        const { project, narration, renderProfile, uxEvidencePath } = parseValidateArgs(rest);
        if (!container.mediaProbe || !container.usageLedger)
          throw new Error("validate requires media probe and usage ledger adapters");
        const paths = projectPaths({ project, cwd, renderProfile, narration });
        const report = await runValidate(
          {
            mediaProbe: container.mediaProbe,
            usageLedger: container.usageLedger,
            ...(container.frameProbe ? { frameProbe: container.frameProbe } : {}),
          },
          {
            paths,
            narration,
            profile: renderProfile,
            ...(uxEvidencePath ? { uxEvidencePath } : {}),
          },
        );
        print(`Validation report written to ${paths.validationReportPath}`);
        return report.status === "passed" ? 0 : 1;
      }
      case "validate-matrix": {
        const { project } = parseDiscoverArgs(rest);
        if (!container.mediaProbe || !container.usageLedger)
          throw new Error("validate-matrix requires media probe and usage ledger adapters");
        const paths = projectPaths({ project, cwd });
        const report = await runValidateMatrix(
          {
            mediaProbe: container.mediaProbe,
            usageLedger: container.usageLedger,
            ...(container.frameProbe ? { frameProbe: container.frameProbe } : {}),
          },
          paths,
        );
        print(`Physical render matrix artifact written to ${paths.physicalRenderMatrixReportPath}`);
        return report.status === "passed" ? 0 : 1;
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
