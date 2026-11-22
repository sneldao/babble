# Babble redesign: shared plan and contracts

Four developers work in parallel. This file is the part everyone reads: the
target, who owns which files, and the contracts between modules. Each developer
then has their own brief:

| Dev | Area | Brief |
|---|---|---|
| A | Reliability, stage core, shell, integration | [dev-a-core.md](dev-a-core.md) |
| B | Sound ribbon, DSP, speed telemetry | [dev-b-ribbon.md](dev-b-ribbon.md) |
| C | Character, audio bus, talk-back voice, UI sounds | [dev-c-character.md](dev-c-character.md) |
| D | Captions, race lanes, start screen, controls, responsive | [dev-d-captions.md](dev-d-captions.md) |

## Why we are doing this

Measured on the current build (`localhost:4319`, 1450x736):

- The cat clip was still queued after 13s; the dog clip sat in queue for 108s
  and never streamed. There is no timeout, cancel or fallback.
- A typed reply produced no vocalization, spinner or error within 15s.
- The first screen is three empty rectangles and an empty sidebar.
- The dog and infant are the cat drawing with ears stretched or hidden.
- The spectrogram renders as faint specks; the pitch contour has no axes.
- The translation is 15px monospace in a 420px sidebar.
- No media queries, no hover/disabled states, one focus style.

## Target

One full-viewport stage, no dashboard columns:

- **Character** upper centre, alive: listens, reacts to the sound, emotes.
- **Sound ribbon** across the lower third: the real DSP, large and annotated.
- **Captions** between them: the translation as large type that the sound
  turns into.
- **Telemetry**: one small instrument readout, plus marks on the ribbon that
  show when the first and last word arrived relative to the sound.
- Every state (idle, listening, queued, streaming, error) is designed.

## Decisions already made (defaults; change here if overruled)

1. **Timeout fallback**: one attempt with a 12s first-token budget. On timeout,
   a demo clip plays a recorded real response, labelled REPLAY in the UI. Mic
   and file captures show an error state with a retry button. We never fall
   back to a different provider silently.
2. **Theme**: light "field notebook". Warm paper, ink text, one signal colour
   per species.
3. **Dependencies**: still no build step. GSAP core and SplitText are vendored
   as plain files, the way the Codrops demos ship them.

## File ownership

Only the owner edits a file. If you need a change in someone else's file, ask
them; do not edit it.

| Path | Owner |
|---|---|
| `server.mjs`, `scripts/record-replays.mjs`, `public/replays/` | A |
| `public/index.html`, `public/app.js`, `public/stage.js`, `public/api.js` | A |
| `public/css/tokens.css`, `public/css/layout.css`, `public/fonts/` | A |
| `public/dev/` (harness and fake stage), `THIRD_PARTY.md` | A |
| `public/acoustics.js`, `public/ribbon.js`, `public/telemetry.js` | B |
| `public/css/ribbon.css`, `public/css/telemetry.css` | B |
| `public/character.js`, `public/audio.js`, `public/synth.js`, `public/sfx.js` | C |
| `public/css/character.css` | C |
| `public/captions.js`, `public/start.js`, `public/controls.js` | D |
| `public/css/captions.css`, `public/css/start.css`, `public/css/controls.css` | D |
| `public/vendor/` (gsap) | D |

`public/style.css` is deleted by A in the scaffold commit.

## Current status (updated 22 Nov, 07:50 UTC)

- **Trunk is `redesign-integration`**, not `redesign`. It is the only branch
  with real captions, start screen and controls. All branches are pushed to
  `origin`.
- **Worktrees:** `babble-dev-a` holds `redesign-integration` and is the only
  place merges into the trunk happen. Every other agent works in its own
  worktree on a short-lived branch cut from `origin/redesign-integration`,
  pushes it, and hands it over to be merged. Do not edit another worktree.
- **Replays are recorded**: `public/replays/<clip>.json` exists for all five
  demo clips (branch `redesign-replays`). To re-record, run
  `BABBLE_RECORD=1 node server.mjs` against the real gateway and play each
  demo clip; `app.js` posts the finished stream to `/api/dev/replay`. Record
  mode raises the first-token budget from 12s to 180s. There is no
  `scripts/record-replays.mjs`; the in-app record mode replaced it.
- **First real end-to-end run** (real OpenClaw gateway, not the mock on 4399):
  interpretation works, but the first token took 24-58s per clip and 3 of 8
  attempts did not finish in 180s. Decode after the first token is about 0.6s.
  With the normal 12s budget every live run falls back to REPLAY, and
  talk-back (`/api/vocalize`, same 12s budget) times out.
- **Where the wait comes from (measured 07:51-07:58 UTC):** the Cerebras
  trial endpoint, not OpenClaw overhead. Direct calls to
  `api.cerebras.ai` with a 137-token prompt got `429 queue_exceeded`
  ("high traffic") 19 times in a row, then one request with a 40 s
  server-side `queue_time`, then four that started in 0.5-2.6 s. OpenClaw
  adds to it: it retries each 429 with growing backoff (1 s up to ~27 s
  gaps), so the same trivial prompt through the gateway took 49-108 s to
  first token. Once admitted, Cerebras generates 60 tokens in 0.06-0.16 s.
  Probes: `/tmp/babble-direct-probe.mjs`, `/tmp/babble-gw-probe.mjs`.
- **Known layout bug:** in the `done` state the header chip line is clipped
  behind the caption and the first caption line scrolls out of view.
- **Agent artefacts** (`.perch/`, `.freebuff/`, `agent-workspace/DREAMS.md`,
  `agent-workspace/memory/`) are gitignored.

## Branches and order

The original plan below is kept for reference; where it disagrees with
"Current status", the status section wins.

- Integration branch: `redesign`, cut from `main`.
- Each dev works on `redesign-<letter>-<area>` (for example `redesign-b-ribbon`) and opens a PR into `redesign`. Git cannot hold both `redesign` and `redesign/...`, so use a hyphen, not a slash.
- **M0, scaffold (A, first commit, before anything else from A):** new
  `index.html` skeleton, `tokens.css`, `layout.css`, fonts, `stage.js`, stub
  modules with the exports below, and the dev harness. B, C and D start on
  their own new files immediately from this document and rebase onto M0 when
  it lands.
- **M1:** each module works in the harness against the fake stage.
- **M2:** all four merged into `redesign`; the real flow works end to end.
- **M3:** polish and the verification pass at the bottom of this file.

The pre-commit hook (`hooks/pre-commit`) runs a secrets scan and `node --check`
on staged JS. Install it with `scripts/install-hooks.sh`.

## DOM skeleton (A lands this; everyone mounts into their own node)

```html
<body data-state="boot" data-species="cat">
  <div id="start"></div>                 <!-- D -->
  <main id="stage">
    <header id="masthead"></header>      <!-- A: brand, engine badge -->
    <section id="character"></section>   <!-- C -->
    <section id="captions"></section>    <!-- D -->
    <section id="ribbon"></section>      <!-- B -->
    <aside id="telemetry"></aside>       <!-- B -->
    <nav id="controls"></nav>            <!-- D -->
    <aside id="log"></aside>             <!-- A: collapsible transcript -->
    <video id="camView" muted autoplay playsinline></video>  <!-- A -->
  </main>
</body>
```

`data-state` and `data-species` on `<body>` are set only by `stage.js`. Style
against them freely (`body[data-state="queued"] #character ...`).

## Module contract

Every UI module is an ES module with one export:

```js
export function mount(el, stage) { /* build DOM inside el, subscribe to stage */ }
```

Modules never import each other. They talk only through `stage`. The
exceptions are the three service modules, which anyone may import:
`stage.js`, `audio.js`, and (A only) `api.js`.

## `stage.js` (A)

```js
export const stage = {
  state,                 // "boot" | "idle" | "listening" | "analysing" |
                         // "queued" | "streaming" | "done" | "error"
  species,               // "cat" | "dog" | "infant"
  set(state, detail),    // sets body[data-state], emits "state"
  setSpecies(id),        // sets body[data-species], emits "species"
  on(type, fn),          // returns an unsubscribe function
  emit(type, detail),
};
export const SPECIES = { cat: {...}, dog: {...}, infant: {...} };
// each: { label, persona, rangeHz: [lo, hi] }  cat [400, 700], dog [250, 500], infant [350, 450]
```

All times are milliseconds on the `performance.now()` clock unless a field
says otherwise.

### Events

| Event | Emitted by | Detail |
|---|---|---|
| `state` | stage | `{ state, prev }` |
| `species` | stage | `{ species }` |
| `capture:start` | A | `{ source: "mic"\|"clip"\|"file", analyser, startedAt, durationMs }` (`analyser` is a live `AnalyserNode`, or `null` for `file`) |
| `analysis` | A | `{ features, buffer }` (see Features below) |
| `interpret:start` | A | `{ lane, t0 }` |
| `interpret:header` | A | `{ lane, vocal, mood, confidence }` (`confidence` 0..1 or `null`) |
| `interpret:delta` | A | `{ lane, text, t, first, tps }` (`text` is utterance body only, header already stripped; `tps` is the running decode rate) |
| `interpret:done` | A | `{ lane, text, queueMs, decodeMs, tokens, tps, replay }` |
| `interpret:error` | A | `{ lane, reason: "timeout"\|"http"\|"network", status }` |
| `reply:sent` | A | `{ text }` |
| `vocalize:play` | A | `{ script, schedule, startedAt, totalMs }` (`schedule[i] = { tMs, durMs, type, shape, pitch, gloss }`) |
| `vocalize:error` | A | `{ reason }` |
| `intent:listen` | D | `{ secs }` |
| `intent:clip` | D | `{ file, species }` |
| `intent:file` | D | `{ file }` (a `File`) |
| `intent:reply` | D | `{ text }` |
| `intent:race` | D | `{ on }` |
| `intent:cam` | D | `{ on }` |
| `intent:retry` | D | `{}` |
| `intent:start` | D | `{}` (start screen dismissed; audio is unlocked) |

`lane` is `"cerebras"` or `"groq"`. The Groq lane only exists when race is on.

State transitions (A drives them):
`boot -> idle` on `intent:start`; `idle|done|error -> listening` on capture;
`listening -> analysing -> queued` when the request is sent;
`queued -> streaming` on the first Cerebras delta; `streaming -> done`;
anything `-> error` on failure. Replay goes through `streaming` and `done`
like a live response, with `replay: true` on `interpret:done`, and A also
emits `interpret:error` first so modules can show why.

## Features (B extends, A forwards to the server unchanged)

`analyzeBuffer(buf)` keeps every existing field, because `server.mjs` reads
them. B adds:

```js
track: { hopMs, f0: number[], rms: number[] },  // one entry per analysis frame; f0 0 = unvoiced
segments[i].startMs, segments[i].endMs,         // added to each existing segment
```

`envelope` (24 values) and `contour` (24 values) stay as they are.

## `audio.js` (C)

One shared `AudioContext` for the whole app. Nobody else calls
`new AudioContext()`.

```js
export function getCtx();               // the shared context
export function unlock();               // resume(); call from a user gesture
export function getOut();               // GainNode into the master bus, mostly dry: clip playback
export function getFxOut();             // GainNode into the master bus with the room reverb: synth and UI sounds
export function playBuffer(buf);        // -> { analyser, startedAt, durationMs }
export async function decode(arrayBuffer); // -> AudioBuffer
```

`captureMic(secs)` stays in `acoustics.js` (B) but uses `getCtx()` and returns
`{ analyser, startedAt, done }` where `done` is a `Promise<AudioBuffer>`.

`synth.js` (C) exports `playScript(script)` returning
`{ startedAt, totalMs, schedule }`; A forwards that as `vocalize:play`.

## Design tokens (`public/css/tokens.css`, A)

```css
:root {
  --paper: #f3ecdf;   --paper-2: #e9e0cf;   --rule: rgb(28 26 23 / 14%);
  --ink: #1c1a17;     --ink-2: #6b645a;
  --cat: #e4572e;     --dog: #c98a1b;       --infant: #3f7fbf;
  --rival: #4a4e9e;   --ok: #2f7d5b;        --warn: #b3261e;
  --signal: var(--cat);
  --font-display: "Host Grotesk", system-ui, sans-serif;
  --font-mono: "Kode Mono", ui-monospace, monospace;
  --step--1: 0.8125rem; --step-0: 1rem; --step-1: 1.375rem;
  --step-2: 2rem; --step-3: clamp(2.25rem, 5vw, 4.5rem);
  --ease-out: cubic-bezier(.2,.8,.2,1); --ease-spring: cubic-bezier(.3,1.6,.5,1);
  --dur-1: 120ms; --dur-2: 240ms; --dur-3: 480ms;
}
body[data-species="dog"]    { --signal: var(--dog); }
body[data-species="infant"] { --signal: var(--infant); }
```

Rules: use `--signal` for anything tied to the animal; never hard-code a
species colour. Display font for words the animal says and headings; mono
only for measurements. No pure black, no drop-shadow glow, no gradient text.

## Reference repos

Clone what your brief names into a scratch folder outside the repo:

```sh
mkdir -p /tmp/codrops-refs && cd /tmp/codrops-refs
for r in codrops/TextCharacterAnimations krisyangdev/jelly thibautlfr/ocarina \
         argofowl/ferro-toggle rauchg/vinyl MatthewGreenberg/beat-machine \
         MatthewGreenberg/skate-dog rock-biter/procedural-eye codrops/GooeyStickyMenu; do
  git clone --depth 1 https://github.com/$r
done
```

Licence rules, which decide what you may copy:

| Repo | Licence | Rule |
|---|---|---|
| TextCharacterAnimations, GooeyStickyMenu, jelly, ocarina, ferro-toggle, vinyl | MIT | Code may be ported. Keep a header comment naming the source and author, and add a line to `THIRD_PARTY.md`. |
| beat-machine, procedural-eye | no licence file | Ideas only. Do not copy code. |
| skate-dog | PolyForm Noncommercial | Ideas only. Do not copy code. |

Fonts: Host Grotesk and Kode Mono are both SIL OFL. A copies the `.woff2`
files and their OFL texts into `public/fonts/`.

## Dev harness (A)

`public/dev/harness.html?m=<module>` mounts one module full-screen against
`public/dev/fake-stage.js`, which runs the real `analyzeBuffer` on a demo
clip and then replays a scripted session (queued for 2s, header, deltas at a
realistic rate, done; plus a reply and an error variant). Use it so nobody is
blocked by the backend queue.

## Definition of done (M3, whole team)

Run in ego browser at 1450x736 and 390x844:

1. Start screen appears; start button unlocks sound and plays the motif.
2. `cat-pleading` and `dog-bark` each reach a finished translation or a
   labelled REPLAY within 15s. Nothing is ever silent for more than 1s.
3. The ribbon shows spectrogram, pitch line, call brackets, and first/last
   word marks. The character's mouth follows the clip.
4. A typed reply shows pending, then plays a vocalization with the character
   animating, or shows a failure with retry.
5. Race on: two lanes side by side with a winner flag (or "Groq offline").
6. Forced timeout (stop the gateway): error state is designed, retry works.
7. Keyboard only: every control reachable, focus visible.
8. `prefers-reduced-motion`: text appears whole, no looping motion.
9. No console errors.
