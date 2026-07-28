import { readFile } from "node:fs/promises";
import type { FinalVideo } from "../../domain/models/media.js";
import type { NarrationMode } from "../../domain/models/narration-mode.js";
import { parseScript } from "../../domain/models/script.js";
import { parseStoryboard } from "../../domain/models/storyboard.js";
import { render } from "../../domain/pipeline/pipeline.js";
import type { EffectsEngine } from "../../domain/ports/effects.js";
import type { PlatformProfile } from "../../domain/ports/platform-profile.js";
import type { PreRollTrimmer } from "../../domain/ports/preroll-trimmer.js";
import type { PrivacyCutter } from "../../domain/ports/privacy-cutter.js";
import type { RecordingEngine } from "../../domain/ports/recording-engine.js";
import type { SceneAssembler } from "../../domain/ports/scene-assembler.js";
import type { SceneSplitter } from "../../domain/ports/scene-splitter.js";
import type { VoiceGen } from "../../domain/ports/voice-gen.js";
import { review } from "../../domain/review-gate.js";
import { type GuideoPaths, projectPaths } from "../paths.js";

// render: the only code path that may reach RecordingEngine/VoiceGen/PlatformProfile — and only
// when `approve` is explicitly true. Without it, this throws before reading or touching anything
// spend-related: no file read, no adapter call. `approve` stands in for the human decision the
// user records by re-running with --approve only after reading `plan`'s printed review — the
// CLI's plan/render split IS the REVIEW gate. `review()` (review-gate.ts) is the only place
// permitted to mint the ApprovedStoryboard the domain render() requires.
export async function runRender(
  container: {
    readonly recordingEngine: RecordingEngine;
    readonly preRollTrimmer: PreRollTrimmer;
    readonly privacyCutter: PrivacyCutter;
    readonly effectsEngine: EffectsEngine;
    readonly sceneSplitter: SceneSplitter;
    readonly sceneAssembler: SceneAssembler;
    readonly voiceGen: VoiceGen;
    readonly platformProfile: PlatformProfile;
  },
  approve: boolean,
  paths: GuideoPaths = projectPaths({ project: "default" }),
  narration: NarrationMode = "both",
): Promise<FinalVideo> {
  if (!approve) {
    throw new Error(
      "guideo render refused: no --approve flag given. Review the script + storyboard printed by " +
        "`guideo plan` (and written under .guideo/), then re-run `guideo render --approve` only " +
        "once you approve. No capture or voice synthesis has run.",
    );
  }

  const script = parseScript(JSON.parse(await readFile(paths.scriptPath, "utf8")));
  const storyboard = parseStoryboard(JSON.parse(await readFile(paths.storyboardPath, "utf8")));
  const approved = review(storyboard, { kind: "approved" });
  if (!approved) {
    throw new Error(
      "unexpected: review() did not mint an ApprovedStoryboard for an approved decision.",
    );
  }

  return render(container, approved, script, paths.outputPath, { narration });
}
