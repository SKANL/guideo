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

## Cross-platform

Guideo targets both macOS and Windows. Use the pinned Node version in `.nvmrc` (via `nvm`/`nvm4w`)
on either platform; all tooling (TypeScript, Vitest, Biome) is cross-platform by design.
