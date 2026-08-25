import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("benchmark:ci requires npm_execpath");
const steps = [
  ["test", ["test"]],
  ["typecheck", ["run", "typecheck"]],
  ["physical-render-matrix", ["run", "test:physical-render:matrix"]],
];

console.log("Deterministic validation benchmark: tests, typecheck, and fixture matrix only; this command does not claim to generate an MP4.");
for (const [name, args] of steps) {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [npmCli, ...args], { stdio: "inherit", shell: false });
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`[benchmark:ci] ${name}: ${elapsedMs}ms`);
}
