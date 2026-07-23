import { describe, expect, it } from "vitest";
import { parseScript, ScriptSchema } from "../../../src/domain/models/script.js";

const validScript = {
  segments: [
    { id: "seg-1", text: "Let's log in.", timing: { startMs: 0, durationMs: 1500 } },
    { id: "seg-2", text: "Enter your email.", timing: { startMs: 1500, durationMs: 2000 } },
  ],
};

describe("ScriptSchema", () => {
  it("parses a valid Script", () => {
    const script = parseScript(validScript);
    expect(script.segments).toHaveLength(2);
    expect(script.segments[0]?.text).toBe("Let's log in.");
  });

  it("rejects a segment with empty text", () => {
    const invalid = {
      segments: [{ id: "seg-1", text: "", timing: { startMs: 0, durationMs: 1000 } }],
    };
    const result = ScriptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("text"))).toBe(true);
    }
  });

  it("rejects a segment with non-positive durationMs", () => {
    const invalid = {
      segments: [{ id: "seg-1", text: "hi", timing: { startMs: 0, durationMs: 0 } }],
    };
    expect(() => parseScript(invalid)).toThrow();
  });

  it("rejects an empty segments array", () => {
    expect(() => parseScript({ segments: [] })).toThrow();
  });
});
