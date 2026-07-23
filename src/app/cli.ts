#!/usr/bin/env node
// Composition root's process shell: the only file that reads process.argv / sets process.exitCode.
// All actual logic (adapter construction: factory.ts, dispatch: run.ts, per-command behavior:
// commands/*.ts) is unit-tested separately with injected fakes — see tests/app/**.
import { createContainer } from "./factory.js";
import { runCli } from "./run.js";

const exitCode = await runCli(process.argv.slice(2), createContainer());
process.exitCode = exitCode;
