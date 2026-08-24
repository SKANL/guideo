import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { formatUxBenchmarkReport, parseUxBenchmarkFixture, runUxBenchmark } from "../../../src/domain/quality/ux-benchmark.js";

describe("UX benchmark", () => {
  it("validates the explicitly synthetic fixture and emits a deterministic report", async () => {
    const fixture = parseUxBenchmarkFixture(JSON.parse(await readFile(new URL("../../fixtures/quality/synthetic-ux-benchmark.json", import.meta.url), "utf8")));
    expect(fixture.synthetic).toBe(true);
    expect(fixture.purpose).toContain("Synthetic");
    expect(formatUxBenchmarkReport(runUxBenchmark(fixture))).toBe(`{
  "schema": "guideo.ux-benchmark-report",
  "version": 1,
  "source": "synthetic",
  "cases": [
    {
      "id": "caption-risk",
      "status": "failed",
      "score": 0.78,
      "failures": [
        "caption distraction 30% exceeds 20%",
        "UX aggregate 78% is below 80%"
      ]
    },
    {
      "id": "clear-success",
      "status": "passed",
      "score": 0.88,
      "failures": []
    }
  ],
  "summary": {
    "total": 2,
    "passed": 1,
    "failed": 1,
    "averageScore": 0.83
  }
}`);
  });

  it("rejects benchmark claims that are not explicitly synthetic", () => {
    expect(() => parseUxBenchmarkFixture({ schema: "guideo.ux-benchmark", version: 1, synthetic: false, purpose: "real", cases: [] })).toThrow("must be explicitly synthetic");
  });
});

