# Guideo — Kickoff Prompt

> Paste this into a fresh Claude Code session opened **inside** `C:\code\camtom-side_projects\guideo`.
> This is the starting context, not the solution. Your job is to refine the idea, decide
> architecture / dependencies / flows, then run SDD → TDD and build it end to end.

## What Guideo is

A tool that records **human-feel teaching/demo videos** of a target platform's flows, use
cases, interfaces and interactions — as if a person were showing you how to use it. The
generated video is the product, and it must **not feel AI-generated**.

The target platform can be provided as:
- a **deployed URL + login credentials** (marketing/non-technical users), or
- **source code** (developers).

Both must funnel through one common `Target` abstraction so the rest of the system does not
care which one it got.

## Approved pipeline

1. **Target** — URL+creds OR source code, behind a common abstraction.
2. **Discovery** — explore the platform and build a **queryable flow graph** (not a flat route
   list): each node tagged with feature, use-case, preconditions, selectors. Re-runnable any
   number of times (the platform changes over time).
3. **Brief** — user submits the general idea of the video + the target social platform.
4. **Plan (script + storyboard)** — AI **queries the graph for only the relevant subset of
   routes** for this video, then generates the narration script and a timed storyboard
   (navigate / click / type / hover / zoom / pause, each mapped to a narration segment).
5. **REVIEW gate** — user reviews script + storyboard **before** any expensive capture or TTS.
   Changing things here is cheap; changing them after render is not.
6. **Capture** — patchright drives the browser executing the storyboard with **human-like
   motion** (mouse easing, typing jitter, natural pauses) → a **platform-agnostic raw clip**.
7. **Voice** — ElevenLabs generates narration from the script segments.
8. **Subtitles** — derived from the script + timing (words are already known; no transcription).
9. **Compose per platform** — **record once, compose many**: each platform version
   (YouTube 16:9, TikTok/Reels 9:16) is a composition pass over the same raw clip
   (reframe, pacing, hook, caption style, voice). No re-recording per platform.
10. **Output** — the final video.

## Architecture bets (already approved — honor these)

- **Record once, compose many.** The raw clip is platform-agnostic; each platform is a
  composition pass.
- **Discovery = queryable flow graph.** Inject only the routes relevant to the requested video
  type; the graph is reusable elsewhere in the system.
- **Review before spend.** The human-in-the-loop gate lives at the storyboard, before capture/TTS.
- **Plugin interfaces from day one:**
  - `RecordingEngine` — web (patchright) now; **mobile later** must plug in without touching the
    rest. Design the seam now, do not implement mobile.
  - `PlatformProfile` — YouTube / Facebook / TikTok. Include an unused **feedback/metrics slot**
    (see deferred scope) so it can be wired later without reshaping the profile.
  - `ScriptGen` / `VoiceGen` — swappable.
- **Human-feel is a cross-cutting concern**, not a final polish step: motion + typing realism in
  capture, conversational script free of AI tells, natural voice.

## Scope for v1

- **In:** the full vision above — web recording, all three platforms (YouTube / Facebook /
  TikTok), discovery, script, storyboard, review, capture, voice, subtitles, compose, output.
- **Deferred (do NOT build now, but leave the seam):**
  - **Metrics feedback loop** — per-platform metrics feeding back to improve future videos.
    Keep the `PlatformProfile` slot; do not implement.
  - **Mobile recording** — architecture-ready via `RecordingEngine`; not implemented.

Even though v1 targets the full vision, **sequence the SDD work as a thin end-to-end slice first**
(one platform, one real flow working from Target → Output), then widen. Do not build breadth on
top of an unproven pipeline.

## Hard constraints

- **All AI runs on the user's MAX subscriptions** (Codex MAX and Claude Code MAX) — use their
  quota. Prefer the **Claude Agent SDK** and **Codex SDK** over paid API keys.
- **Voice:** ElevenLabs.
- **Every other external service:** free tier unless the user says otherwise.
- Guideo should be usable by a running Claude Code / Codex session (terminal or another
  interface, depending on need).
- **Windows** host (PowerShell primary; Bash available for POSIX).

## How to start this session

1. Ask any clarifying questions needed to lock architecture and dependency choices (patchright
   setup, video composition tool — e.g. ffmpeg, storyboard/graph data model, where the flow
   graph is stored, how routes are injected at record time).
2. Propose the concrete tech stack and dependency list, with tradeoffs, and get approval.
3. Run **SDD** (proposal → spec → design → tasks), then implement with **strict TDD**.
4. Build the **thin vertical slice first**, prove it end to end, then expand to the full vision.

The full approved design is also in Engram under topic key `architecture/demo-video-generator`.
