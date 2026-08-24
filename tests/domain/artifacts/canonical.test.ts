import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../../../src/domain/artifacts/canonical.js";
import { approvalManifest } from "../../../src/domain/artifacts/manifest.js";

describe("canonical artifact identity", () => {
  it("sorts object keys while retaining array order without erasing semantic property names", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, items: ["b", "a"], createdAt: "semantic" })).toBe('{"createdAt":"semantic","items":["b","a"],"nested":{"a":1,"b":2},"z":1}');
    expect(sha256({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  });
  it("does not collide objects that differ only by a formerly-denied property name", () => {
    expect(sha256({ createdAt: "first" })).not.toBe(sha256({ createdAt: "second" }));
  });
  it("binds approval to exactly the flow graph, script, storyboard, and policy hashes", () => {
    const manifest = approvalManifest({ flowGraph: "a", script: "b", storyboard: "c", policy: "d" });
    expect(manifest.inputs).toEqual({ flowGraph: "a", script: "b", storyboard: "c", policy: "d" });
    expect(Object.isFrozen(manifest)).toBe(true);
  });
});
