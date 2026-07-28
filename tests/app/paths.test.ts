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
      scriptPath: join(guideoDir, "script.json"),
      storyboardPath: join(guideoDir, "storyboard.json"),
      outputPath: join(guideoDir, "output", "youtube.mp4"),
    });
  });

  it("uses the given platform for the output filename", () => {
    const paths = projectPaths({ project: "acme", platform: "tiktok", cwd: "/work" });

    expect(paths.outputPath).toBe(
      join("/work", ".guideo", "projects", "acme", "output", "tiktok.mp4"),
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
