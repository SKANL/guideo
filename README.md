# Guideo

Guideo generates a walkthrough demo video of a web application from a single target URL and
credentials: it discovers the app's flows, plans a narrated storyboard, waits for human review and
approval, then records the screen, synthesizes voice narration, and composes the final video.

## Requirements

- Node.js 24.x (see `.nvmrc`)
- npm

## Install

```sh
npm install
```

## Test

```sh
npm test          # run the test suite once
npm run test:watch # watch mode
npm run typecheck  # tsc --noEmit
npm run lint       # biome check
```

## Usage

Guideo is a three-command CLI. `plan` is a **hard stop**: it only ever reads the target and calls
the script generator — it never captures the screen, never synthesizes voice, and never composes a
video. Only `render --approve`, run after you've reviewed the plan, does that.

```sh
# 1. Configure credentials + voice key (never commit .env — it is git-ignored)
cp env.example .env
# edit .env: GUIDEO_TARGET_URL, GUIDEO_TARGET_USERNAME, GUIDEO_TARGET_PASSWORD, ELEVENLABS_API_KEY

# 2. Discover the target app's flows -> .guideo/flow-graph.json
npm run guideo -- discover

# 3. Plan a script + storyboard from a brief -> .guideo/{script,storyboard}.json, printed for review
npm run guideo -- plan --brief "Show how to invite a teammate" --platform youtube

# 4. Review the printed script + storyboard. Only once you approve:
npm run guideo -- render --approve
# -> prints the path to the final 16:9 .mp4

# Without --approve, render always refuses and does nothing:
npm run guideo -- render
```

`node --env-file-if-exists=.env` (baked into the `guideo` npm script) loads `.env` automatically;
it never errors if `.env` is missing (e.g. `guideo --help` needs no environment at all).

If you `npm link` this package, the same commands are available as a plain `guideo` binary
(`bin/guideo.mjs`, resolved via `tsx`'s `--import` loader — no build step):

```sh
guideo discover
guideo plan --brief "..." --platform youtube
guideo render --approve
```

### Required environment

| Var | Required for | Notes |
| --- | --- | --- |
| `GUIDEO_TARGET_URL`, `GUIDEO_TARGET_USERNAME`, `GUIDEO_TARGET_PASSWORD` | `discover`, `plan` | Target app login |
| `ELEVENLABS_API_KEY` | `render` | ElevenLabs free tier |
| `GUIDEO_FFMPEG_PATH` | `render` (optional) | Override the bundled `ffmpeg-static` binary |

Script/storyboard generation (`ScriptGen`) runs on the **Claude Agent SDK** and does not read any
env var itself — it spawns the local `claude` CLI subprocess, which inherits your shell's
environment and authenticates the same way the interactive `claude` CLI does. Run `claude` once
and log in (MAX subscription) before running `guideo discover`/`plan` for the first time; no
`ANTHROPIC_API_KEY` is required or read by this project.

Missing required env vars fail fast with a clear message naming the missing variable(s) — nothing
runs silently.

## Cross-platform

Guideo targets both macOS and Windows. Use the pinned Node version in `.nvmrc` (via `nvm`/`nvm4w`)
on either platform; all tooling (TypeScript, Vitest, Biome, tsx) is cross-platform by design. The
`guideo` npm script and `bin/guideo.mjs` both resolve paths via `node:path`/`node:url` (no
POSIX-only shell syntax), so both work unmodified in PowerShell and in bash/zsh.
