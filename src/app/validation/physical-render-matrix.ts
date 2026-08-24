import type { RenderProfileName } from "../../domain/models/media.js";
import type { NarrationMode } from "../../domain/models/narration-mode.js";

export type PhysicalRenderMatrixNarration = Extract<NarrationMode, "silent" | "subtitles" | "both">;

export interface PhysicalRenderValidationScenario {
  readonly id: `${RenderProfileName}-${PhysicalRenderMatrixNarration}`;
  readonly profile: RenderProfileName;
  readonly narration: PhysicalRenderMatrixNarration;
  readonly width: number;
  readonly height: number;
  readonly hasAudio: boolean;
}

const profiles = [
  ["youtube", 1920, 1080],
  ["shorts", 1080, 1920],
  ["square", 1080, 1080],
] as const satisfies readonly (readonly [RenderProfileName, number, number])[];
const narrations = [
  ["silent", false],
  ["subtitles", false],
  ["both", true],
] as const satisfies readonly (readonly [PhysicalRenderMatrixNarration, boolean])[];

export const PHYSICAL_RENDER_VALIDATION_MATRIX: readonly PhysicalRenderValidationScenario[] =
  profiles.flatMap(([profile, width, height]) =>
    narrations.map(([narration, hasAudio]) => ({
      id: `${profile}-${narration}`,
      profile,
      narration,
      width,
      height,
      hasAudio,
    })),
  );

export function physicalRenderValidationScenario(
  profile: RenderProfileName,
  narration: NarrationMode,
): PhysicalRenderValidationScenario | undefined {
  return PHYSICAL_RENDER_VALIDATION_MATRIX.find(
    (scenario) => scenario.profile === profile && scenario.narration === narration,
  );
}

/** Returns deterministic definition errors so CI can reject accidental matrix drift. */
export function validatePhysicalRenderMatrix(
  matrix: readonly PhysicalRenderValidationScenario[] = PHYSICAL_RENDER_VALIDATION_MATRIX,
): readonly string[] {
  const expectedIds = profiles.flatMap(([profile]) =>
    narrations.map(([narration]) => `${profile}-${narration}`),
  );
  if (matrix.length !== expectedIds.length)
    return [`matrix must contain ${expectedIds.length} scenarios; received ${matrix.length}`];

  const actualIds = matrix.map((scenario) => scenario.id);
  const errors = expectedIds.flatMap((id, index) =>
    actualIds[index] === id
      ? []
      : [`matrix scenario ${index} must be ${id}; received ${actualIds[index] ?? "missing"}`],
  );
  for (const scenario of matrix) {
    const profile = profiles.find(([name]) => name === scenario.profile);
    const expectedAudio = narrations.find(([name]) => name === scenario.narration)?.[1];
    if (!profile || scenario.width !== profile[1] || scenario.height !== profile[2])
      errors.push(`${scenario.id} has invalid dimensions`);
    if (expectedAudio === undefined || scenario.hasAudio !== expectedAudio)
      errors.push(`${scenario.id} has invalid audio expectation`);
  }
  return errors;
}
