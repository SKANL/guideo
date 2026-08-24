import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { sha256 } from "../../domain/artifacts/canonical.js";
import { type ArtifactManifest } from "../../domain/artifacts/manifest.js";
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
import type { UsageLedger } from "../../domain/ports/usage-ledger.js";
import { reviewWithManifest } from "../../domain/review-gate.js";
import { assertQuality } from "../../domain/quality/quality-gate.js";
import type { MediaProbe } from "../../domain/ports/media-probe.js";
import { toSrt } from "../../adapters/compose/srt.js";
import { type GuideoPaths, projectPaths } from "../paths.js";

export async function runRender(
  container: { readonly recordingEngine: RecordingEngine; readonly preRollTrimmer: PreRollTrimmer; readonly privacyCutter: PrivacyCutter; readonly effectsEngine: EffectsEngine; readonly sceneSplitter: SceneSplitter; readonly sceneAssembler: SceneAssembler; readonly voiceGen: VoiceGen; readonly platformProfile: PlatformProfile; readonly mediaProbe?: MediaProbe; readonly usageLedger?: UsageLedger },
  approve: boolean,
  paths: GuideoPaths = projectPaths({ project: "default" }),
  narration: NarrationMode = "both",
): Promise<FinalVideo> {
  if (!approve) throw new Error("guideo render refused: no --approve flag given. Review `guideo plan` output before rendering.");
  const script = parseScript(JSON.parse(await readFile(paths.scriptPath, "utf8")));
  const storyboard = parseStoryboard(JSON.parse(await readFile(paths.storyboardPath, "utf8")));
  const graph = JSON.parse(await readFile(paths.flowGraphPath, "utf8"));
  const actual = { flowGraph: sha256(graph), script: sha256(script), storyboard: sha256(storyboard), policy: sha256({ version: 2 }) };
  let manifest: ArtifactManifest;
  try { manifest = JSON.parse(await readFile(paths.approvalManifestPath, "utf8")) as ArtifactManifest; }
  catch { throw new Error("render requires an existing finalized approval manifest"); }
  if (manifest.finalized !== true) throw new Error("render requires an existing finalized approval manifest");
  const approved = reviewWithManifest(storyboard, manifest, actual);
  if (!approved) throw new Error("finalized approval manifest did not approve storyboard");
  const visibleSegmentIds = new Set(
    storyboard.steps
      .filter((step) => step.visibility !== "private")
      .map((step) => step.narrationSegmentId),
  );
  const visibleSegments = script.segments.filter((segment) => visibleSegmentIds.has(segment.id));
  const captionSegments = visibleSegments.map((segment, index) => ({
    text: segment.text,
    startMs: visibleSegments.slice(0, index).reduce((total, item) => total + item.timing.durationMs, 0),
    durationMs: segment.timing.durationMs,
  }));
  const reservation = await container.usageLedger?.reserve({ operation: "render", estimated: 1 });
  const token = randomUUID();
  const temporaryVideoPath = join(dirname(paths.outputPath), `.${token}.mp4`);
  const temporaryCaptionsPath = join(dirname(paths.captionsPath), `.${token}.srt`);
  let externalWorkCompleted = false;
  try {
    await mkdir(dirname(paths.outputPath), { recursive: true });
    await mkdir(dirname(paths.captionsPath), { recursive: true });
    const video = await render(container, approved, script, temporaryVideoPath, { narration });
    externalWorkCompleted = true;
    await writeFile(temporaryCaptionsPath, toSrt(captionSegments), "utf8");
    if (container.mediaProbe) assertQuality(await container.mediaProbe.probe(video.path), { expectedDurationMs: visibleSegments.reduce((total, segment) => total + segment.timing.durationMs, 0), minimumDurationRatio: 0.9, expectedSegments: visibleSegments.length, actualSegments: visibleSegmentIds.size, narration, captionsRequired: true, hasCaptions: (await readFile(temporaryCaptionsPath, "utf8")).trim().length > 0 });
    if (reservation) await container.usageLedger!.commit(reservation.id, { cost: 1, cached: false });
    await rename(video.path, paths.outputPath);
    await rename(temporaryCaptionsPath, paths.captionsPath);
    return { ...video, path: paths.outputPath };
  } catch (error) {
    await Promise.all([unlink(temporaryVideoPath).catch(() => undefined), unlink(temporaryCaptionsPath).catch(() => undefined)]);
    if (reservation && !externalWorkCompleted) await container.usageLedger!.release(reservation.id, "render failed");
    throw error;
  }
}
