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

  it("derives stable, purposeful beats from step order and narration timing", () => {
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
    const beats = first.beats.filter((beat) => beat.stepIndex === 1);
    expect(beats.map((beat) => beat.kind)).toEqual(["establish", "action", "result", "hold"]);
    expect(beats.map((beat) => beat.startMs + beat.durationMs)).toEqual([700, 840, 1000, 1100]);
  });

  it("uses a stable selector as fallback evidence when Discover did not attach prose", () => {
    const storyboard = parseStoryboard({
      steps: [{ action: "click", selector: "[data-test=checkout]", narrationSegmentId: "seg-1" }],
    });

    expect(deriveMotionPlan(storyboard, script).beats[1]?.target).toEqual({
      selector: "[data-test=checkout]",
      evidence: "[data-test=checkout]",
    });
  });

  it("marks only explicitly requested, evidenced focus cues as zoom-eligible", () => {
    const storyboard = parseStoryboard({
      steps: [
        { action: "type", selector: "#email", narrationSegmentId: "seg-1" },
        { action: "click", selector: "#invite", narrationSegmentId: "seg-1" },
        { action: "click", selector: "#confirm", narrationSegmentId: "seg-2", params: { requiresFocus: true }, evidence: { reference: "Confirm invitation" } },
      ],
    });
    const plan = deriveMotionPlan(storyboard, script);
    expect(plan.beats.filter((beat) => beat.stepIndex === 1 && beat.kind === "action")[0]).toMatchObject({
      intent: "action",
      zoomEligible: false,
    });
    expect(plan.beats.filter((beat) => beat.stepIndex === 2 && beat.kind === "action")[0]).toMatchObject({
      intent: "action",
      zoomEligible: true,
    });
    expect(plan.beats.filter((beat) => beat.stepIndex === 0).map((beat) => beat.intent)).toEqual(["establish"]);
  });

  it("declares a deterministic purpose, postcondition, and safe caption region instead of treating every click as a zoom", () => {
    const storyboard = parseStoryboard({
      steps: [{
        action: "click",
        selector: "#invite",
        narrationSegmentId: "seg-1",
        evidence: { reference: "Invite teammate", expectedPostState: "Invitation dialog is visible" },
      }],
    });

    const plan = deriveMotionPlan(storyboard, script);
    const action = plan.beats.find((beat) => beat.kind === "action");
    const result = plan.beats.find((beat) => beat.kind === "result");

    expect(action).toMatchObject({
      intent: "action",
      rationale: "show the click on Invite teammate",
      target: { selector: "#invite", evidence: "Invite teammate" },
      postcondition: { evidence: "Invitation dialog is visible" },
      confidence: "high",
      captionSafeRegion: "lower-third",
      zoomEligible: false,
    });
    expect(result).toMatchObject({ intent: "result", rationale: "show that Invitation dialog is visible" });
  });
});
