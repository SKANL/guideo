import { describe, expect, it } from "vitest";
import { BriefSchema, parseBrief } from "../../../src/domain/models/brief.js";

const validBrief = {
  idea: "Show new users how to invite a teammate",
  targetPlatform: "youtube",
};

describe("BriefSchema", () => {
  it("parses a valid Brief", () => {
    const brief = parseBrief(validBrief);
    expect(brief.idea).toBe(validBrief.idea);
    expect(brief.targetPlatform).toBe("youtube");
  });

  it("rejects an empty idea", () => {
    const result = BriefSchema.safeParse({ ...validBrief, idea: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("idea"))).toBe(true);
    }
  });

  it("rejects an unsupported targetPlatform", () => {
    expect(() => parseBrief({ ...validBrief, targetPlatform: "instagram" })).toThrow();
  });
});
