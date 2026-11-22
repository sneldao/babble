# Dev A: reliability, stage core, shell, integration

Read [README.md](README.md) first. You own the contracts in it. Your scaffold
commit (M0) unblocks the other three, so it comes before everything else here.

## Files you own

`server.mjs`, `scripts/record-replays.mjs`, `public/replays/`,
`public/index.html`, `public/app.js`, `public/stage.js`, `public/api.js`,
`public/css/tokens.css`, `public/css/layout.css`, `public/fonts/`,
`public/dev/`, `THIRD_PARTY.md`. You delete `public/style.css`.

## M0: scaffold (first commit)

1. `public/index.html`: the skeleton from the README, linking every CSS file
   and loading `app.js` as a module. Vendor script tags for gsap come from D;
   leave a marked slot.
2. `public/css/tokens.css`: exactly the tokens in the README, plus
   `@font-face` for Host Grotesk and Kode Mono.
3. `public/fonts/`: copy `HostGrotesk-Latin.woff2` and `OFL-HostGrotesk.txt`
   from `TextCharacterAnimations/fonts/`, and `kode-mono-latin-400.woff2` and
   `kode-mono-OFL.txt` from `procedural-eye/fonts/`.
4. `public/css/layout.css`: the stage grid (below) and the masthead.
5. `public/stage.js`: the bus and state machine from the README.
6. Stub files with the agreed exports and no behaviour, so imports resolve:
   `ribbon.js`, `telemetry.js`, `character.js`, `captions.js`, `start.js`,
   `controls.js` (each `export function mount() {}`), and `audio.js`
   (a minimal working version: shared context, `getOut()` returning
   `ctx.destination` wrapped in a gain, `getFxOut()` returning the same node,
   `playBuffer`, `decode`). Owners
   replace their stubs.
7. `public/dev/harness.html` and `public/dev/fake-stage.js` as described in
   the README.
8. `THIRD_PARTY.md` with the fonts; other devs add their lines.

### Stage grid

Desktop (>= 900px), one viewport tall, no page scroll:

```
masthead   masthead   masthead
character  character  telemetry
captions   captions   captions
ribbon     ribbon     ribbon
controls   controls   controls
```

Rows roughly `auto / 34vh / 1fr / 26vh / auto`. `#log` is a drawer that
slides over the right edge. Under 900px: single column in the order
masthead, character, captions, ribbon, controls; telemetry collapses into one
line above the ribbon; `#controls` is sticky at the bottom. D owns the
insides of `#controls`; you own where it sits.

## Reliability (`server.mjs`, `public/api.js`)

The gateway on `:18789` answers, so the 108s hang is upstream of it. Locate
it before designing around it:

1. Log per request in `server.mjs`: time to upstream headers, time to first
   content delta, total, status. One line each.
2. Probe the same payload against the gateway and against Cerebras directly
   and record where the wait is. Put the finding in the PR description.

Then:

3. `gatewayChat`: pass an `AbortSignal`; abort when the browser disconnects
   (`req.on("close")`) so abandoned requests stop holding the queue.
4. `pumpSse`: send a `{ queued: true }` keep-alive event every second until
   the first delta, and send `{ error }` instead of ending silently when the
   upstream read throws (today the `catch {}` swallows it).
5. `handleVocalize`: return within the same 12s budget; on failure respond
   with `{ script: null, reason }` and a non-200 status.
6. `public/api.js`: `interpret(payload, { lane, signal })` and
   `vocalize(payload, { signal })`. Each uses an `AbortController` with a 12s
   first-token (or response) budget, parses the SSE, strips the
   `VOCAL/MOOD/CONFIDENCE/---` header, and calls back with header, body
   deltas, done and error. Compute `tps` from deltas as they arrive (use the
   server's token estimate: one token per four characters), `queueMs` as
   request to first delta, `decodeMs` as first delta to done.
7. Remove the `history` array from the payload only if you confirm the
   OpenClaw session keeps context; otherwise leave it.

## Replay fallback

- `scripts/record-replays.mjs`: for each clip in `public/clips/`, takes a
  recorded live response and writes `public/replays/<clip>.json`:
  `{ species, header: { vocal, mood, confidence }, deltas: [{ tMs, text }], recordedAt }`.
  The feature analysis runs in the browser, so the simplest route is a
  hidden `?record=1` mode in `app.js` that POSTs the captured stream to a
  dev-only endpoint which writes the file.
- On an interpret timeout for `source: "clip"`, emit `interpret:error`, then
  play the replay through the same `interpret:header` / `interpret:delta` /
  `interpret:done` events with `replay: true`.
- For mic and file there is no replay: go to `error` and wait for
  `intent:retry`.

## `public/app.js` (wiring only, no drawing)

Handle intents and emit the events in the README. Specifically:

- `intent:listen`: `captureMic(secs)` from B, emit `capture:start`, await the
  buffer, `analyzeBuffer`, emit `analysis`, then interpret.
- `intent:clip`: fetch, `decode`, `playBuffer` from C, emit `capture:start`
  with the returned analyser, then the same path. Switch species first if the
  clip names one.
- `intent:file`: decode and analyse, no playback.
- If `features.f0Median === 0`, go to `error` with reason "nothing voiced".
- `intent:race`: when on, start a second `interpret` with `lane: "groq"`
  against `/api/compare` alongside the Cerebras one.
- `intent:reply`: emit `reply:sent`, call `vocalize`, then `playScript` from
  C and emit `vocalize:play`, or `vocalize:error`.
- `intent:cam`: the existing webcam logic, unchanged in behaviour.
- Wrap every await in error handling that ends in a stage state. No path may
  leave the UI in `queued` forever.

## `#masthead` and `#log`

- Masthead: wordmark "Babble", the tagline, and an engine badge reading the
  model from `/api/config`. Display font, no pulsing dot.
- Log: a drawer listing finished turns (species, class, mood, utterance,
  reply). Closed by default, toggled by a button and the `L` key.

## Acceptance

- With the gateway stopped: a clip run reaches a labelled replay, a mic run
  reaches the error state, both within 13s; `intent:retry` works.
- With the gateway healthy: events arrive in the documented order with
  sensible `queueMs`, `decodeMs` and `tps`.
- Closing the tab mid-request aborts the upstream call (visible in the log
  line).
- The harness runs every module against the fake stage with no backend.
- `node --check` passes on every file; no console errors.

## Integration duty

You merge the other three PRs into `redesign`, resolve contract questions,
and run the M3 checklist in the README. Any contract change is made in
`README.md` first and announced.
