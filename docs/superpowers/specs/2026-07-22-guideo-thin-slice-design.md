# Guideo — Thin Vertical Slice Design

> Status: approved (2026-07-22). Source of truth for the first end-to-end slice.
> Full product vision lives in `PROMPT.md`. This document scopes the first slice
> and fixes the seams so the full vision can be widened onto it without rework.

## Goal

Prove the pipeline end to end on the narrowest real path: one owned target app
(URL + credentials) → one YouTube 16:9 video → not feeling AI-generated. Widen
to other targets, platforms, and source-code targets only after this holds.

## Locked decisions

| Area | Decision | Notes |
|---|---|---|
| Runtime | TypeScript / Node | Claude Agent SDK & Codex SDK are TS-first; one language for orchestration + tool. |
| Browser capture | `patchright` (Node) | Verified maintained. **Chromium-only** — no Firefox/WebKit; capture is always a Chromium engine. |
| Video compose | `ffmpeg` via CLI | Binary resolved per-OS. |
| Voice | ElevenLabs | Hard constraint from PROMPT. |
| AI | Claude Agent SDK / Codex SDK | Runs on user's MAX subscriptions. No paid API keys. Every other external service: free tier. |
| Cross-platform | macOS + Windows, by discipline | Node `path` for all paths; per-OS binary resolution; no shell assumptions (no hardcoded PowerShell/bash). |
| Slice target | Own app via URL + creds | Exercises the URL+creds branch (non-technical-user path). |
| Slice output | YouTube 16:9 | Lowest-risk compose: raw clip is already landscape, near-identity reframe. |

## Seams (interfaces from day one)

Each interface exists from the start; the slice implements exactly one variant.
Everything in the "deferred" column is an empty seam — designed for, not built.

| Interface | Slice implementation | Deferred (seam only) |
|---|---|---|
| `Target.discover() → FlowGraph` | `UrlCredsTarget` | `SourceCodeTarget` |
| `RecordingEngine.capture(storyboard) → RawClip` | `WebRecordingEngine` (patchright) | mobile engine |
| `ScriptGen.generate(brief, routes) → Script` | Claude Agent SDK impl | swappable providers |
| `VoiceGen.synthesize(segments) → Audio` | `ElevenLabsVoice` | swappable providers |
| `PlatformProfile` (compose params + unused `metrics` slot) | `YouTubeProfile` | `TikTokProfile`, `FacebookProfile`, metrics feedback loop |

## Pipeline (slice flow)

```
Discovery ──► FlowGraph (JSON on disk, re-runnable)
                 │
Brief (idea + target social platform)
                 │
Plan ──► query relevant route subset ──► Script + Storyboard
                 │
REVIEW gate ◄── human approves BEFORE any capture/TTS spend
                 │
Capture (patchright, human-feel) ──► raw clip (platform-agnostic, 16:9)
                 │
Voice (ElevenLabs from script segments)
                 │
Subtitles (derived from script + timing; no transcription)
                 │
Compose (ffmpeg, YouTubeProfile) ──► final video
```

**Record once, compose many:** the raw clip is platform-agnostic; each platform
is a composition pass over it. The slice runs one pass (YouTube); the seam lets
others be added without re-recording.

**Review before spend:** the human-in-the-loop gate sits at the storyboard,
before capture and TTS. Cheap to change there, expensive after render.

## Data models

**FlowGraph** — queryable, not a flat route list.
- Node = screen/route, tagged `{ feature, useCase, preconditions, selectors }`.
- Edge = transition, carrying the action that moves A → B.
- Stored as JSON on disk, queried in memory to inject only the relevant subset.
- **Not a graph DB** (ponytail): at this scale in-memory query over JSON is
  enough. Upgrade path: SQLite only if querying measurably hurts.
- Re-runnable any number of times (the target platform changes over time).

**Storyboard** — ordered steps.
- `{ action: navigate | click | type | hover | zoom | pause, selector, params, narrationSegmentId }`.
- Each step maps to a narration segment with timing, so subtitles and voice
  derive from known words (no transcription).

## Human-feel (cross-cutting, not a final polish step)

- **Capture:** mouse easing (bezier paths), typing jitter, natural pauses.
- **Script:** conversational prompt, free of AI tells.
- **Voice:** natural ElevenLabs settings.

Leave calibration knobs on the motion/timing realism — the physical feel needs
tuning a minimal model can't predict up front.

## Out of scope for the slice (seam only)

- `SourceCodeTarget` (source-code targets)
- Mobile `RecordingEngine`
- `TikTokProfile` / `FacebookProfile` (9:16 vertical, hook, caption styling)
- Metrics feedback loop (the unused `PlatformProfile.metrics` slot)

## Next

SDD (proposal → spec → design → tasks) then strict TDD, building this slice
first and widening only after it proves out end to end.
