import { describe, expect, it } from "vitest";
import { evaluateUx } from "../../../src/domain/quality/ux-evaluation.js";

describe("UX evaluation", () => {
  it("passes a professional, comprehensible delivery with unobtrusive captions", () => {
    expect(evaluateUx({
      targetComprehension: 0.9,
      resultComprehension: 0.8,
      captionDistraction: 0.1,
      professionalismTrust: 0.9,
      retentionProxy: 0.8,
    })).toEqual({
      status: "passed",
      score: 0.86,
      failures: [],
    });
  });

  it("aggregates normalized scores deterministically and reports every failed threshold", () => {
    expect(evaluateUx({
      targetComprehension: 0.79,
      resultComprehension: 0.7,
      captionDistraction: 0.21,
      professionalismTrust: 0.79,
      retentionProxy: 0.69,
    })).toEqual({
      status: "failed",
      score: 0.75,
      failures: [
        "target comprehension 79% is below 80%",
        "result comprehension 70% is below 80%",
        "caption distraction 21% exceeds 20%",
        "professionalism and trust 79% is below 80%",
        "retention proxy 69% is below 70%",
        "UX aggregate 75% is below 80%",
      ],
    });
  });

  it("rejects non-normalized measurements before calculating a report", () => {
    expect(() => evaluateUx({
      targetComprehension: 1.01,
      resultComprehension: 0.8,
      captionDistraction: 0.1,
      professionalismTrust: 0.8,
      retentionProxy: 0.7,
    })).toThrow("targetComprehension must be between 0 and 1");
  });
});
