#!/usr/bin/env node
// Global/linked `guideo` bin entry. Runs the TS CLI entry point directly via tsx's `--import`
// loader hook (Node >=20.6, ponytail: no build step needed — see design's "Env/secrets" and
// npm script `guideo` for the equivalent `npm run guideo -- <command>` local dev path).
// `--env-file-if-exists=.env` loads .env from the CALLER's cwd if present; it never errors when
// missing (e.g. `guideo --help` needs no env at all).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../src/app/cli.ts", import.meta.url));

const result = spawnSync(
  process.execPath,
  ["--env-file-if-exists=.env", "--import", "tsx", cliPath, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
