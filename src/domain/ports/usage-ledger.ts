export interface BudgetRequest { readonly operation: string; readonly estimated: number; }
export interface Reservation { readonly id: string; readonly request: BudgetRequest; }
export interface UsageActual { readonly cost: number; readonly cached: boolean; }
export interface UsageSnapshot { readonly spent: number; readonly reserved: number; }
export interface UsageLedger { reserve(request: BudgetRequest): Promise<Reservation>; commit(id: string, actual: UsageActual): Promise<void>; release(id: string, reason: string): Promise<void>; snapshot(): Promise<UsageSnapshot>; }
