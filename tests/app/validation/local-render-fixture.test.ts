import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localRenderFixture } from "../../../src/app/validation/local-render-fixture.js";

describe("localRenderFixture", () => {
  it("uses the checked-in local target and a deterministic artifact path", async () => {
    const fixture = localRenderFixture(process.cwd());

    await expect(access(fileURLToPath(fixture.targetUrl))).resolves.toBeUndefined();
    expect(fixture.recordingPath).toMatch(/\.guideo[\\/]fixtures[\\/]local-render\.mp4$/);
    expect(fixture.captionsPath).toMatch(/\.guideo[\\/]fixtures[\\/]local-render\.srt$/);
  });
});
