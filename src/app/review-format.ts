import type { Script } from "../domain/models/script.js";
import type { Storyboard } from "../domain/models/storyboard.js";

// Human-readable rendering of a planned Script + Storyboard for the REVIEW gate's printed output.
// No capture/voice has run yet — this only summarizes plan's pure output for a human to read
// before deciding whether to run `guideo render --approve`.
export function formatReview(script: Script, storyboard: Storyboard): string {
  const lines: string[] = ["=== Script ==="];
  for (const segment of script.segments) {
    lines.push(
      `[${segment.id}] (${segment.timing.startMs}ms, +${segment.timing.durationMs}ms): ${segment.text}`,
    );
  }

  lines.push("", "=== Storyboard ===");
  for (const step of storyboard.steps) {
    const selectorPart = step.selector ? ` ${step.selector}` : "";
    lines.push(`- ${step.action}${selectorPart} -> narration:${step.narrationSegmentId}`);
  }

  lines.push(
    "",
    "Nothing has been captured or synthesized yet. Review the above, then run:",
    "  guideo render --approve",
  );
  return lines.join("\n");
}
