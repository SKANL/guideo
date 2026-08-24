import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileUsageLedger } from "../../../src/adapters/usage/file-usage-ledger.js";
import type { UsageUnit } from "../../../src/domain/ports/usage-ledger.js";

const accountingUnit: UsageUnit = "usd-micros";
// @ts-expect-error Accounting accepts USD micros only.
const incompatibleAccountingUnit: UsageUnit = "provider-credits";
void accountingUnit;
void incompatibleAccountingUnit;
describe("FileUsageLedger", () => { it("reserves before spend, commits actuals, releases failures, and stops over budget", async () => { const root = await mkdtemp(join(tmpdir(), "guideo-ledger-")); try { const ledger = new FileUsageLedger(join(root, "usage.json"), { limit: 10 }); const first = await ledger.reserve({ operation: "voice", estimated: 6 }); await expect(ledger.reserve({ operation: "voice", estimated: 5 })).rejects.toThrow("budget"); await ledger.commit(first.id, { cost: 4, cached: false }); const second = await ledger.reserve({ operation: "voice", estimated: 6 }); await ledger.release(second.id, "provider failed"); expect((await ledger.snapshot()).spent).toBe(4); } finally { await rm(root, { recursive: true, force: true }); } }); });
describe("FileUsageLedger provider-cost contract", () => {
  it("uses usd-micros for estimate, commit, and snapshot while retaining legacy callers", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const ledger = new FileUsageLedger(join(root, "usage.json"), { limit: 10 });
      const reservation = await ledger.reserve({
        operation: "voice",
        estimate: { unit: "usd-micros", amount: 6 },
      });

      await ledger.commit(reservation.id, {
        unit: "usd-micros",
        amount: 4,
        cache: "miss",
        provider: "elevenlabs",
      });

      expect(await ledger.snapshot()).toEqual({ spent: 4, reserved: 0, unit: "usd-micros" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a commit whose provider-cost unit differs from its reservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const ledger = new FileUsageLedger(join(root, "usage.json"), { limit: 10 });
      const reservation = await ledger.reserve({
        operation: "script",
        estimate: { unit: "usd-micros", amount: 5 },
      });

      await expect(
        ledger.commit(reservation.id, { unit: "provider-credits" as never, amount: 1, cache: "hit" }),
      ).rejects.toThrow(/unit/i);
      expect((await ledger.snapshot()).reserved).toBe(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
describe("FileUsageLedger commit validation", () => {
  it("rejects invalid or over-budget actual costs while retaining the reservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const ledger = new FileUsageLedger(join(root, "usage.json"), { limit: 10 });
      const reservation = await ledger.reserve({ operation: "render", estimated: 5 });
      await expect(ledger.commit(reservation.id, { cost: Number.NaN, cached: false })).rejects.toThrow(/finite.*non-negative/i);
      await expect(ledger.commit(reservation.id, { cost: 11, cached: false })).rejects.toThrow(/budget/i);
      expect((await ledger.snapshot()).reserved).toBe(5);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("FileUsageLedger concurrency", () => {
  it("fails closed on a stale lock rather than stealing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const file = join(root, "usage.json");
      await writeFile(`${file}.lock`, JSON.stringify({ token: "abandoned-owner", acquiredAt: 0 }), "utf8");
      const ledger = new FileUsageLedger(file, { limit: 10 }, { staleLockMs: 1 });
      await expect(ledger.reserve({ operation: "voice", estimated: 6 })).rejects.toThrow(/stale lock/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails closed on malformed persisted usage instead of resetting the budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const file = join(root, "usage.json");
      await writeFile(file, '{"spent":', "utf8");
      const ledger = new FileUsageLedger(file, { limit: 10 });
      await expect(ledger.reserve({ operation: "voice", estimated: 1 })).rejects.toThrow(/corrupt/i);
      await expect(ledger.snapshot()).rejects.toThrow(/corrupt/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects persisted accounting data in a non-USD unit while accepting legacy USD state", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const file = join(root, "usage.json");
      await writeFile(file, JSON.stringify({
        unit: "provider-credits",
        spent: 0,
        reservations: {},
      }), "utf8");
      const ledger = new FileUsageLedger(file, { limit: 10 });

      await expect(ledger.snapshot()).rejects.toThrow(/usd-micros|corrupt/i);

      await writeFile(file, JSON.stringify({ spent: 1, reservations: {} }), "utf8");
      await expect(ledger.snapshot()).resolves.toEqual({ spent: 1, reserved: 0, unit: "usd-micros" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("serializes independent ledger instances without stealing a live lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const file = join(root, "usage.json");
      const first = new FileUsageLedger(file, { limit: 10 });
      const second = new FileUsageLedger(file, { limit: 10 });
      const results = await Promise.allSettled([
        first.reserve({ operation: "voice", estimated: 6 }),
        second.reserve({ operation: "voice", estimated: 6 }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((await first.snapshot()).reserved).toBe(6);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

  it("reports cache-hit savings without changing the existing spend contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "guideo-ledger-"));
    try {
      const ledger = new FileUsageLedger(join(root, "usage.json"), { limit: 10 });
      const reservation = await ledger.reserve({ operation: "scene-effects", estimated: 5 });
      await ledger.commit(reservation.id, { unit: "usd-micros", amount: 0, cache: "hit", avoidedAmount: 5 });
      expect(await ledger.snapshot()).toEqual({ spent: 0, reserved: 0, unit: "usd-micros", cacheHits: 1, cacheSavings: 5 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
