import { describe, expect, it } from "vitest";
import { parseMotionPlan } from "../../../src/domain/models/motion-plan.js";
import { parseScript } from "../../../src/domain/models/script.js";
import { parseStoryboard } from "../../../src/domain/models/storyboard.js";
import { deriveMotionPlan } from "../../../src/domain/pipeline/motion-planner.js";

const script = parseScript({
  segments: [
    { id: "seg-1", text: "Open the invite menu.", timing: { startMs: 100, durationMs: 1000 } },
    { id: "seg-2", text: "Confirm the invitation.", timing: { startMs: 1100, durationMs: 800 } },
  ],
});

describe("MotionPlan", () => {
  it("validates beat timing and semantic focus targets", () => {
    expect(() =>
      parseMotionPlan({
        beats: [
          { kind: "action", narrationSegmentId: "seg-1", stepIndex: 0, startMs: -1, durationMs: 1 },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseMotionPlan({
        beats: [
          {
            kind: "action",
            narrationSegmentId: "seg-1",
            stepIndex: 0,
            startMs: 0,
            durationMs: 1,
            target: { selector: "" },
          },
        ],
      }),
    ).toThrow();

    expect(
      parseMotionPlan({
        beats: [
          {
            kind: "action",
            narrationSegmentId: "seg-1",
            stepIndex: 0,
            startMs: 100,
            durationMs: 450,
            target: { selector: "#invite", evidence: "Invite team member" },
          },
        ],
      }).beats,
    ).toHaveLength(1);
  });

  it("derives stable setup/action/reaction/hold beats from step order and narration timing", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "navigate", narrationSegmentId: "seg-1" },
        {
          action: "click",
          selector: "#invite",
          narrationSegmentId: "seg-1",
          evidence: { reference: "Invite team member" },
        },
        { action: "pause", narrationSegmentId: "seg-2" },
      ],
    });

    const first = deriveMotionPlan(storyboard, script);
    const second = deriveMotionPlan(storyboard, script);

    expect(second).toEqual(first);
    expect(first.beats.filter((beat) => beat.stepIndex === 1)).toEqual([
      {
        kind: "setup",
        narrationSegmentId: "seg-1",
        stepIndex: 1,
        startMs: 600,
        durationMs: 75,
        target: { selector: "#invite", evidence: "Invite team member" },
      },
      {
        kind: "action",
        narrationSegmentId: "seg-1",
        stepIndex: 1,
        startMs: 675,
        durationMs: 225,
        target: { selector: "#invite", evidence: "Invite team member" },
      },
      {
        kind: "reaction",
        narrationSegmentId: "seg-1",
        stepIndex: 1,
        startMs: 900,
        durationMs: 125,
        target: { selector: "#invite", evidence: "Invite team member" },
      },
      {
        kind: "hold",
        narrationSegmentId: "seg-1",
        stepIndex: 1,
        startMs: 1025,
        durationMs: 75,
        target: { selector: "#invite", evidence: "Invite team member" },
      },
    ]);
  });
});
