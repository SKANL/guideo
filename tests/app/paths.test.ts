import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectPaths } from "../../src/app/paths.js";

describe("projectPaths", () => {
  it("resolves the project-scoped layout under .guideo/projects/<project>/", () => {
    const paths = projectPaths({ project: "acme", cwd: "/work" });

    const guideoDir = join("/work", ".guideo", "projects", "acme");
    expect(paths).toEqual({
      guideoDir,
      flowGraphPath: join(guideoDir, "flow-graph.json"),
      flowGraphCachePath: join(guideoDir, "flow-graph-cache.json"),
      capabilityProfilePath: join(guideoDir, "capability-profile.json"),
      discoveryObservationPlanPath: join(guideoDir, "discovery-observation-plan.json"),
      scriptPath: join(guideoDir, "script.json"),
      storyboardPath: join(guideoDir, "storyboard.json"),
      approvalManifestPath: join(guideoDir, "approval-manifest.json"),
      captionsPath: join(guideoDir, "captions.srt"),
      outputPath: join(guideoDir, "output", "youtube.mp4"),
      validationReportPath: join(guideoDir, "validation-report.json"),
      checkpointReportPath: join(guideoDir, "output", "youtube-both.checkpoint-report.json"),
      physicalRenderMatrixReportPath: join(guideoDir, "physical-render-matrix-report.json"),
    });
  });

  it("uses the given platform for the output filename", () => {
    const paths = projectPaths({ project: "acme", platform: "tiktok", cwd: "/work" });

    expect(paths.outputPath).toBe(
      join("/work", ".guideo", "projects", "acme", "output", "tiktok.mp4"),
    );
  });

  it("isolates profile and narration variants without changing the legacy youtube/both paths", () => {
    const legacy = projectPaths({
      project: "acme",
      cwd: "/work",
      renderProfile: "youtube",
      narration: "both",
    });
    const shorts = projectPaths({
      project: "acme",
      cwd: "/work",
      renderProfile: "shorts",
      narration: "silent",
    });
    expect(legacy.outputPath).toBe(join(legacy.guideoDir, "output", "youtube.mp4"));
    expect(shorts.outputPath).toBe(join(shorts.guideoDir, "output", "shorts-silent.mp4"));
    expect(shorts.captionsPath).toBe(join(shorts.guideoDir, "output", "shorts-silent.srt"));
    expect(shorts.validationReportPath).toBe(
      join(shorts.guideoDir, "output", "shorts-silent.validation-report.json"),
    );
  });

  it("defaults cwd to process.cwd() when omitted", () => {
    const paths = projectPaths({ project: "acme" });

    expect(paths.guideoDir).toBe(join(process.cwd(), ".guideo", "projects", "acme"));
  });

  it("isolates two different projects under the same cwd into different directories", () => {
    const a = projectPaths({ project: "project-a", cwd: "/work" });
    const b = projectPaths({ project: "project-b", cwd: "/work" });

    expect(a.guideoDir).not.toBe(b.guideoDir);
    expect(a.flowGraphPath).not.toBe(b.flowGraphPath);
  });
});
