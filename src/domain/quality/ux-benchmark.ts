import { evaluateUx, type UxEvaluationInput, type UxEvaluationReport } from "./ux-evaluation.js";

export const UX_BENCHMARK_SCHEMA = "guideo.ux-benchmark";
export const UX_BENCHMARK_VERSION = 1;
export const UX_BENCHMARK_REPORT_SCHEMA = "guideo.ux-benchmark-report";

export interface UxBenchmarkFixture {
  readonly schema: typeof UX_BENCHMARK_SCHEMA;
  readonly version: typeof UX_BENCHMARK_VERSION;
  readonly synthetic: true;
  readonly purpose: string;
  readonly cases: readonly { readonly id: string; readonly input: UxEvaluationInput }[];
}

export interface UxBenchmarkReport {
  readonly schema: typeof UX_BENCHMARK_REPORT_SCHEMA;
  readonly version: typeof UX_BENCHMARK_VERSION;
  readonly source: "synthetic";
  readonly cases: readonly ({ readonly id: string } & UxEvaluationReport)[];
  readonly summary: { readonly total: number; readonly passed: number; readonly failed: number; readonly averageScore: number };
}

/** Validates the benchmark schema and rejects any fixture that could be mistaken for real-user evidence. */
export function parseUxBenchmarkFixture(value: unknown): UxBenchmarkFixture {
  if (!isRecord(value) || value.schema !== UX_BENCHMARK_SCHEMA || value.version !== UX_BENCHMARK_VERSION) throw new Error("invalid UX benchmark schema");
  if (value.synthetic !== true) throw new Error("UX benchmark must be explicitly synthetic");
  if (typeof value.purpose !== "string" || value.purpose.length === 0) throw new Error("UX benchmark purpose is required");
  if (!Array.isArray(value.cases)) throw new Error("UX benchmark cases must be an array");
  const cases = value.cases.map((entry) => parseCase(entry));
  if (new Set(cases.map((entry) => entry.id)).size !== cases.length) throw new Error("UX benchmark case ids must be unique");
  return { schema: UX_BENCHMARK_SCHEMA, version: UX_BENCHMARK_VERSION, synthetic: true, purpose: value.purpose, cases };
}

export function runUxBenchmark(fixture: UxBenchmarkFixture): UxBenchmarkReport {
  const cases = [...fixture.cases]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, input }) => ({ id, ...evaluateUx(input) }));
  const passed = cases.filter((entry) => entry.status === "passed").length;
  return {
    schema: UX_BENCHMARK_REPORT_SCHEMA,
    version: UX_BENCHMARK_VERSION,
    source: "synthetic",
    cases,
    summary: { total: cases.length, passed, failed: cases.length - passed, averageScore: roundToHundredths(cases.reduce((sum, entry) => sum + entry.score, 0) / (cases.length || 1)) },
  };
}

export function formatUxBenchmarkReport(report: UxBenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

function parseCase(value: unknown): { readonly id: string; readonly input: UxEvaluationInput } {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || !isRecord(value.input)) throw new Error("invalid UX benchmark case");
  const input = value.input as Record<string, unknown>;
  const keys: (keyof UxEvaluationInput)[] = ["targetComprehension", "resultComprehension", "captionDistraction", "professionalismTrust", "retentionProxy"];
  for (const key of keys) if (typeof input[key] !== "number") throw new Error(`UX benchmark ${key} must be a number`);
  return { id: value.id, input: input as unknown as UxEvaluationInput };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function roundToHundredths(value: number): number { return Math.round(value * 100) / 100; }
