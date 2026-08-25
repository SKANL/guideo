/** Accounting uses integer USD micros throughout (1 USD = 1_000_000 micros). */
export type UsageUnit = "usd-micros";
export interface UsageEstimate { readonly unit: UsageUnit; readonly amount: number; }
export interface UsageResult extends UsageEstimate {
  readonly cache: "hit" | "miss";
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly characters?: number;
  /** Cost avoided by an idempotent cache hit, in the same unit. */
  readonly avoidedAmount?: number;
}
/** @deprecated Use UsageResult. Retained while callers migrate. */
export interface UsageActual { readonly cost: number; readonly cached: boolean; }
export interface BudgetRequest {
  readonly operation: string;
  readonly estimate?: UsageEstimate;
  /** @deprecated Legacy amount in usd-micros. Use estimate.amount. */
  readonly estimated?: number;
}
export interface Reservation { readonly id: string; readonly request: BudgetRequest; }
export interface UsageSnapshot { readonly spent: number; readonly reserved: number; readonly unit?: UsageUnit; /** Additive cache telemetry; absent for legacy ledgers. */ readonly cacheHits?: number; readonly cacheSavings?: number; readonly cacheByOperation?: Readonly<Record<string, { readonly hits: number; readonly savings: number; readonly spent: number }>>; }
export type UsageCommit = UsageResult | UsageActual;
export interface UsageLedger {
  reserve(request: BudgetRequest): Promise<Reservation>;
  commit(id: string, actual: UsageCommit): Promise<void>;
  release(id: string, reason: string): Promise<void>;
  snapshot(): Promise<UsageSnapshot>;
}
