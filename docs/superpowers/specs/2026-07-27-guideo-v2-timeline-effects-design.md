# Guideo v2 — Scene Timeline, Effects, Privacy & Multi-Project Design

> Status: approved direction (2026-07-27). Builds on the proven thin slice
> (`2026-07-22-guideo-thin-slice-design.md`). Foundation-first sequencing; AI
> proposes effects, human adjusts at the REVIEW gate; all editing happens by
> editing the timeline at the gate.

## Why (learnings from the first real e2e)

The thin slice produced a real video but the e2e surfaced patterns, not one-offs:
- **DOM realism** — capture must survive real apps (overlays, responsive nav,
  hydration, non-anchor nav, patchright disabling the a11y tree).
- **Provider limits are first-class** — TTS tier/concurrency, LLM schema dialect.
- **The storyboard is an LLM-authored artifact** — the engine must be tolerant
  and self-verifying, not assume clean input.
- **Timing must be narration-driven** — capturing and narrating independently
  gave a 21s video against a 43s script.

Meta-lesson: today Guideo *executes and muxes blind*. To make better videos by
itself it needs (a) narration-driven timing, (b) per-step verification/self-heal,
and (c) a composable edit stage so quality is built, not hoped for.

## The unifying model: a scene timeline + composable stages

Replace the coarse `plan → capture(one clip) → voice → subs → compose(one pass)`
with a **timeline of scenes** flowing through small, composable stages.

### Data model

```
Timeline {
  scenes: Scene[]
}
Scene {
  id: string
  action: { type: navigate|click|hover|zoom|type|pause, selector?, params? }
  narrationSegmentId: string        // -> Script segment; its TTS audio sets scene duration
  effects: Effect[]                 // AI-proposed, user-editable at the gate
  visibility: "show" | "private"    // "private" => excluded from output (privacy)
}
Effect {
  type: "zoom-in"|"zoom-out"|"pan"|"crop"|"transition"|"trim"|"blur-region"
  params: Record<string, unknown>   // e.g. blur-region: {x,y,w,h,fromMs,toMs}
}
```

`ApprovedStoryboard` remains the branded compile-time gate; it now wraps a
`Timeline`. The Script/segment model is unchanged.

### Staged pipeline

```
1. Plan    → Timeline (+ Script)         AI drafts scenes + suggested effects + visibility
2. Voice   → audio per segment           runs BEFORE capture so each scene's duration is known
3. Capture → one clip per scene          each scene paced to fill its narration duration
4. Edit    → per-scene Effect chain       zoom/crop/transition/trim/blur applied via ffmpeg
5. Compose → assemble per platform        stitch scene clips + audio + subs → final video
```

Stages are independently testable and re-runnable. `Voice → Capture` ordering is
the timing fix. `Edit` is the new extensibility surface.

## Feature designs (the parts to figure out)

### A. Timing (narration-driven)
- Synthesize voice first; `Audio.durationMs` becomes each scene's target length.
- Capture paces a scene to its target: after the action, dwell/ease/pause to fill
  the remaining time (bounded human-feel jitter), so clip length ≈ narration length.
- Compose places audio segment N over scene clip N; subtitles derive from the same
  known timing. No global 21-vs-43 mismatch.
- Leave a `timingSlackMs` knob (physical capture never hits an exact millisecond).

### B. Effects stage (extensible plugin seam)
- `Effect` port: `apply(inputClip, params) -> outputClip` implemented via ffmpeg
  filtergraphs. Mirrors the existing RecordingEngine/PlatformProfile seam.
- Basic set v2 (ffmpeg filters): `zoom-in`/`zoom-out` (`zoompan`), `crop`/`pan`
  (`crop`), `transition` between scenes (`xfade`), `trim` (cut dead time to the
  narration window), `blur-region` (`crop`→`boxblur`→`overlay` gated by
  `enable='between(t,a,b)'`).
- AI proposes effects per scene in Plan (e.g. zoom-in when narration highlights a
  stat); user edits them at the gate. A registry maps `type` → ffmpeg builder so
  new effects (advanced, later) plug in without touching the pipeline.

### C. Privacy / redaction (falls out of the model)
Two mechanisms, both editable at the REVIEW gate, no new UI:
- **Scene visibility `private`** — the scene is captured but excluded from the
  composed output (or replaced by a cut). Primary use: start the *shown* video
  after login, so credentials are never in the output even though capture logged in.
- **`blur-region` effect** — blur a rectangle over a time range (e.g. an email
  field). Region + range live in the effect params; user sets them at the gate.
Guideo's ScriptGen marks login/auth scenes `private` by default; the user can
flip any scene.

### D. Multi-project output
- A `Project` namespaces a target + its graph + its briefs/videos.
- Store layout (project-scoped, replaces the flat `.guideo/`):
  ```
  .guideo/projects/<project>/
    flow-graph.json
    videos/<brief-slug>/
      script.json  timeline.json
      scenes/scene-<id>.mp4        (raw per-scene clips)
      edited/scene-<id>.mp4        (post-effects)
      output/<platform>.mp4        (final, STABLE path — fixes the temp-dir issue)
  ```
- Project selected via `--project <name>` (default from cwd/config). `discover`,
  `plan`, `render` all operate within the selected project. Output paths are
  stable and versioned per brief/platform — no more OS temp dir.

### E. Self-healing capture (better videos by itself)
- After each action, verify: navigate → URL changed; click/hover → element was
  found visible and the expected effect happened. On failure: retry with a
  fallback (text selector, or derive the href and `goto`), then `log` what it did.
- Discovery: extract link data atomically with `$$eval` (no ElementHandles held
  across navigations) to kill the intermittent "execution context destroyed"
  race; retry once on that specific error.

## Sequencing (foundation-first — approved)

1. **Fixes + robustness** — discovery `$$eval`/retry (kills the flaky race). Small.
2. **Multi-project store** — project-scoped layout + stable output path (folds in
   the honest "output in temp dir" fix).
3. **Timeline + narration-driven timing** — the storyboard becomes a Timeline;
   voice-before-capture; scenes paced to narration. The base everything sits on.
4. **Effects stage** — `Effect` seam + basic set + AI proposes / user edits.
5. **Privacy/redaction** — scene `private` + `blur-region`, default-private login.
6. **Self-healing capture** — per-step verification + selector fallback.

Each sub-project: strict TDD, one (or few) commits, review checkpoint before the
next. Deferred still-deferred: mobile RecordingEngine, source-code Target,
metrics feedback loop, advanced/AI-driven video effects.

## Non-goals for v2
- No dedicated visual editor UI (editing is timeline-JSON at the gate).
- No advanced effects (motion tracking, auto-captioned highlights) — the seam is
  designed for them; not implemented.
