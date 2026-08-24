import type { UxEvaluationInput } from "./ux-evaluation.js";

export const REAL_UX_EVIDENCE_SCHEMA = "guideo.real-ux-evidence";
export const REAL_UX_EVIDENCE_REPORT_SCHEMA = "guideo.real-ux-evidence-report";
export const REAL_UX_EVIDENCE_VERSION = 1;

type Rating = UxEvaluationInput;

export interface RealUxEvidence {
  readonly schema: typeof REAL_UX_EVIDENCE_SCHEMA;
  readonly version: typeof REAL_UX_EVIDENCE_VERSION;
  readonly kind: "real";
  readonly source: {
    readonly system: string;
    readonly method: "session-rating";
    readonly collectedAt: string;
  };
  readonly consent: { readonly obtained: true; readonly policyVersion: string };
  readonly sessions: readonly {
    readonly anonymousSessionId: string;
    readonly rating: Rating;
    readonly observation?: string;
  }[];
}

export interface RealUxEvidenceReport {
  readonly schema: typeof REAL_UX_EVIDENCE_REPORT_SCHEMA;
  readonly version: typeof REAL_UX_EVIDENCE_VERSION;
  readonly source: "real";
  readonly sessions: number;
  readonly metrics: Rating;
}

/** Parses only consented, anonymized observations; synthetic baselines use ux-benchmark.ts instead. */
export function parseRealUxEvidence(value: unknown): RealUxEvidence {
  if (
    !isRecord(value) ||
    value.schema !== REAL_UX_EVIDENCE_SCHEMA ||
    value.version !== REAL_UX_EVIDENCE_VERSION ||
    value.kind !== "real"
  )
    throw new Error("invalid real UX evidence schema");
  if (value.example === true) throw new Error("real UX evidence cannot be an example");
  if (
    !isRecord(value.source) ||
    typeof value.source.system !== "string" ||
    value.source.system.trim().length === 0 ||
    value.source.method !== "session-rating" ||
    !isIsoDate(value.source.collectedAt)
  )
    throw new Error("real UX evidence source metadata is required");
  if (
    !isRecord(value.consent) ||
    value.consent.obtained !== true ||
    typeof value.consent.policyVersion !== "string" ||
    value.consent.policyVersion.trim().length === 0
  )
    throw new Error("real UX evidence consent must be obtained with a policy version");
  if (!Array.isArray(value.sessions) || value.sessions.length === 0)
    throw new Error("real UX evidence requires at least one session");
  const sessions = value.sessions.map(parseSession);
  if (new Set(sessions.map((session) => session.anonymousSessionId)).size !== sessions.length)
    throw new Error("real UX evidence anonymousSessionIds must be unique");
  return {
    schema: REAL_UX_EVIDENCE_SCHEMA,
    version: REAL_UX_EVIDENCE_VERSION,
    kind: "real",
    source: {
      system: value.source.system.trim(),
      method: "session-rating",
      collectedAt: value.source.collectedAt,
    },
    consent: { obtained: true, policyVersion: value.consent.policyVersion.trim() },
    sessions,
  };
}

export function aggregateRealUxEvidence(evidence: RealUxEvidence): RealUxEvidenceReport {
  const metrics = Object.fromEntries(
    metricKeys.map((key) => [
      key,
      roundToHundredths(
        evidence.sessions.reduce((total, session) => total + session.rating[key], 0) /
          evidence.sessions.length,
      ),
    ]),
  ) as unknown as Rating;
  return {
    schema: REAL_UX_EVIDENCE_REPORT_SCHEMA,
    version: REAL_UX_EVIDENCE_VERSION,
    source: "real",
    sessions: evidence.sessions.length,
    metrics,
  };
}

const metricKeys: readonly (keyof Rating)[] = [
  "targetComprehension",
  "resultComprehension",
  "captionDistraction",
  "professionalismTrust",
  "retentionProxy",
];

function parseSession(value: unknown): RealUxEvidence["sessions"][number] {
  if (
    !isRecord(value) ||
    typeof value.anonymousSessionId !== "string" ||
    !/^anon-[a-z0-9]{8,}$/i.test(value.anonymousSessionId) ||
    value.anonymousSessionId.includes("@")
  )
    throw new Error("real UX evidence anonymousSessionId must use the anon- identifier format");
  if (!isRecord(value.rating)) throw new Error("real UX evidence rating is required");
  const rating = Object.fromEntries(
    metricKeys.map((key) => {
      const metric = (value.rating as Record<string, unknown>)[key];
      if (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0 || metric > 1)
        throw new Error(`real UX evidence ${key} must be between 0 and 1`);
      return [key, metric];
    }),
  ) as unknown as Rating;
  if (
    value.observation !== undefined &&
    (typeof value.observation !== "string" || value.observation.length > 1_000)
  )
    throw new Error("real UX evidence observation must be a string up to 1000 characters");
  return {
    anonymousSessionId: value.anonymousSessionId,
    rating,
    ...(typeof value.observation === "string" ? { observation: value.observation } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}
