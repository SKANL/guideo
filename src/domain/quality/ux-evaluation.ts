export interface UxEvaluationInput {
  readonly targetComprehension: number;
  readonly resultComprehension: number;
  readonly captionDistraction: number;
  readonly professionalismTrust: number;
  readonly retentionProxy: number;
}

export interface UxEvaluationReport {
  readonly status: "passed" | "failed";
  readonly score: number;
  readonly failures: readonly string[];
}

const minimumTargetComprehension = 0.8;
const minimumResultComprehension = 0.8;
const maximumCaptionDistraction = 0.2;
const minimumProfessionalismTrust = 0.8;
const minimumRetentionProxy = 0.7;
const minimumAggregateScore = 0.8;

export function evaluateUx(input: UxEvaluationInput): UxEvaluationReport {
  validateNormalized(input);

  const failures: string[] = [];
  const captionClarity = 1 - input.captionDistraction;
  const score = roundToHundredths((
    input.targetComprehension
    + input.resultComprehension
    + captionClarity
    + input.professionalismTrust
    + input.retentionProxy
  ) / 5);

  if (input.targetComprehension < minimumTargetComprehension) failures.push(`target comprehension ${formatPercent(input.targetComprehension)} is below ${formatPercent(minimumTargetComprehension)}`);
  if (input.resultComprehension < minimumResultComprehension) failures.push(`result comprehension ${formatPercent(input.resultComprehension)} is below ${formatPercent(minimumResultComprehension)}`);
  if (input.captionDistraction > maximumCaptionDistraction) failures.push(`caption distraction ${formatPercent(input.captionDistraction)} exceeds ${formatPercent(maximumCaptionDistraction)}`);
  if (input.professionalismTrust < minimumProfessionalismTrust) failures.push(`professionalism and trust ${formatPercent(input.professionalismTrust)} is below ${formatPercent(minimumProfessionalismTrust)}`);
  if (input.retentionProxy < minimumRetentionProxy) failures.push(`retention proxy ${formatPercent(input.retentionProxy)} is below ${formatPercent(minimumRetentionProxy)}`);
  if (score < minimumAggregateScore) failures.push(`UX aggregate ${formatPercent(score)} is below ${formatPercent(minimumAggregateScore)}`);

  return { status: failures.length === 0 ? "passed" : "failed", score, failures };
}

function validateNormalized(input: UxEvaluationInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  }
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
