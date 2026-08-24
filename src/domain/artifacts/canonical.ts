import { createHash } from "node:crypto";
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]),
  );
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical JSON does not allow non-finite numbers");
  return value;
}
export function canonicalJson(value: unknown): string { return JSON.stringify(normalize(value)); }
export function sha256(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
export function sha256Bytes(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
