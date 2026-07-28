import { describe, expect, it } from "vitest";
import { defaultProjectName } from "../../src/app/project-name.js";

describe("defaultProjectName", () => {
  it("slugifies the host of GUIDEO_TARGET_URL", () => {
    expect(defaultProjectName("https://camtom-webapp.vercel.app/")).toBe(
      "camtom-webapp-vercel-app",
    );
  });

  it("includes a non-default port in the slug", () => {
    expect(defaultProjectName("http://localhost:3000")).toBe("localhost-3000");
  });

  it("falls back to 'default' when the URL env var is absent", () => {
    expect(defaultProjectName(undefined)).toBe("default");
  });

  it("falls back to 'default' when the URL is malformed", () => {
    expect(defaultProjectName("not a url")).toBe("default");
  });
});
