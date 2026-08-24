import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileUsageLedger } from "../../../src/adapters/usage/file-usage-ledger.js";
describe("FileUsageLedger", () => { it("reserves before spend, commits actuals, releases failures, and stops over budget", async () => { const root = await mkdtemp(join(tmpdir(), "guideo-ledger-")); try { const ledger = new FileUsageLedger(join(root, "usage.json"), { limit: 10 }); const first = await ledger.reserve({ operation: "voice", estimated: 6 }); await expect(ledger.reserve({ operation: "voice", estimated: 5 })).rejects.toThrow("budget"); await ledger.commit(first.id, { cost: 4, cached: false }); const second = await ledger.reserve({ operation: "voice", estimated: 6 }); await ledger.release(second.id, "provider failed"); expect((await ledger.snapshot()).spent).toBe(4); } finally { await rm(root, { recursive: true, force: true }); } }); });
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
