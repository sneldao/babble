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
3. **Dependencies**: still no build step and no vendored libraries. Caption
   motion is CSS plus `requestAnimationFrame`, with the mechanics ported from
   the Codrops Voice Note effect (see `THIRD_PARTY.md`).

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
| `public/captions.js`, `public/start.js`, `public/controls.js`, `public/goo.js` | D |
| `public/css/captions.css`, `public/css/start.css`, `public/css/controls.css`, `public/css/goo.css` | D |

`public/style.css` is deleted by A in the scaffold commit.

## Current status (updated 22 Nov, 13:52 UTC)

- **Everything is merged to `main`.** `main`, `redesign` and
  `redesign-integration` all point at the same commit; the per-developer
  branches are fully merged (deleted locally, kept on `origin` for history)
  and their worktrees removed.
- **Hosted demo: live at https://sneldao.github.io/babble/ and verified in a
  real browser** — clip run reaches `done` with zero console errors, REPLAY
  labels visible on caption and telemetry. When `api/config` is unreachable
  (or `?demo` is set), sample clips replay their recorded real responses
  after a short queue beat, and mic/file/reply show an honest "hosted demo"
  note. Deployed as a `gh-pages` branch containing `public/` at its root
  (plus `.nojekyll`); all app URLs are relative for the `/babble/` subpath.
  **After changing `public/`, redeploy with
  `git subtree push --prefix public origin gh-pages`.**
- **Bring your own pet (22 Nov, 12:36 UTC).** Upload (or drop on the stage) a video,
  a sound file or a photo. Audio and video share one path: the file is
  decoded in the browser, clips over 12 s are cut to their loudest 12 s
  (`loudestWindow` in `audio.js`), and the upload now plays aloud so the
  ribbon paints live. For a video the frame at the loudest moment is grabbed
  and sent as `image` with `imageKind: "moment"`; a photo is kept as a
  portrait and sent with each later sound as `imageKind: "portrait"`; the
  webcam stays `"cam"`. The server tells the agent which kind it is (text in
  `buildInterpretMessages`, matching sentence in `agent-workspace/SOUL.md`).
  The picture shows in a snapshot card beside the character
  (`public/snapshot.js`), labelled `sent with the sound` or `shown only`, and
  the ribbon marks the frame's time. `BABBLE_VISION=0` stops pictures being
  sent. Verified live: the Cerebras model named the colour of a test image
  called directly and through the OpenClaw gateway, and a real upload run
  came back with "frame unusable" in its evidence for a test-pattern frame.
  In the hosted demo an upload is measured and drawn, then says the live
  translation needs the local build (neutral wording, not an error).
  Not tested: a real phone camera roll, Safari, and a video of a real animal.
- **Pitch tracking for real recordings (22 Nov, 13:52 UTC).** A real outdoor video
  (a cat on a roof, quiet audio, a steady hum at about half the cat's pitch)
  showed the original per-frame autocorrelation reading 222 Hz for a 450 Hz
  call. `analyzeBuffer` now has two paths. Mic and uploads use a
  noise-tolerant tracker: the mean spectrum of the quietest tenth of the clip
  is subtracted as background, each frame's autocorrelation candidates are
  ranked by the energy in their first five harmonics, a path search stops the
  line jumping an octave, and calls under 60 ms are dropped. On that video it
  now reads two calls at 429 Hz falling and 397 Hz, which matches a
  spectrogram made separately with ffmpeg. Sample clips pass
  `{ pinned: true }` and keep the original tracker, because their recorded
  replays quote its numbers; the pinned path is byte-identical to before on
  all five clips. On the cat samples the two paths agree within a few Hz; on
  the two dog samples they differ by up to an octave on some barks and
  neither has been checked against a reference. One real video is the only
  real-world check so far.
- **Polish landed:** the GooeyStickyMenu stretch item is in — a goo-filter
  pill (SVG blur + alpha ramp, `public/goo.js`) slides under the active
  species button on the start screen and in the controls. The stage now
  enters in a staggered sequence when the start dialog lifts, and the
  verdict header stamps in with the ferro spring.
- **Live OpenClaw config for agent `babble`:** the workspace is the main
  checkout's `agent-workspace/`, `thinkingDefault: "low"`, `skills: []`,
  tools `read`/`write`/`edit` confined to the workspace. The Cerebras model
  entry declares `reasoning: true` with an effort map so `low` is actually
  sent. Backups: `~/.openclaw/openclaw.json.bak-babble` and
  `.bak-pre-submission`.
- **Verified live on this build (08:58-09:07 UTC, real gateway):** all five
  demo clips interpreted with an evidence line (wait 2.1-5.5 s, decode
  0.17-0.46 s); a typed reply was vocalized in 2.3 s; the next capture
  answered in context ("Six is entirely too late"); the session-end memory
  write succeeded. In the same period two requests got no answer in 180 s
  and one came back empty, so the trial queue is still unreliable.
- **Replays are recorded with evidence** for all five clips
  (`public/replays/`). They are real first-turn responses. To re-record, run
  `BABBLE_RECORD=1 node server.mjs` and play each demo clip once after a page
  reload; record mode raises the first-token budget from 12 s to 180 s,
  records only the first interpretation of a page session, and refuses empty
  responses.
- **Where the wait comes from:** the Cerebras trial endpoint. Direct calls
  alternate between about 10 s of normal answers and about 50 s of
  `429 queue_exceeded`; OpenClaw retries each 429 with growing backoff
  (hardcoded: 1 s base, doubling, 30 s cap, 90 s budget; no config setting).
  We do not patch OpenClaw. `node scripts/cerebras-window.mjs` shows whether
  the endpoint is admitting requests; start a live take on `<- go`.
- **Failure handling:** 12 s without a first word (8 s mid-stream), an HTTP
  error, or an empty answer falls back to the clip's labelled REPLAY; mic and
  file captures show an error with Retry. Talk-back has no fallback.
- **Not configured: the GPU race lane.** Agent `babble-gpu` needs
  `NEBIUS_API_KEY` in the gateway's environment, a gateway restart, then
  `scripts/setup-openclaw.sh`. Until then the race lane shows
  "GPU rival offline (not configured)". The rival path is tested against a
  mock only.
- **Not tested:** a real microphone capture (automation has no mic).
- **Checks:** `node scripts/devc-smoke.mjs`, `node scripts/devd-smoke.mjs`,
  `node scripts/ribbon-evidence-test.mjs`.
- **Agent artefacts** (`.perch/`, `.freebuff/`, `agent-workspace/DREAMS.md`,
  `agent-workspace/memory/`) are gitignored.

## Left before submission (22 Nov, 12:56 UTC)

| # | Item | Owner | Notes |
|---|---|---|---|
| 1 | Speed bounty post | you (in progress) | Figures fixed: 1,032 TPS p90 server-side, 572 mean on the same run. Draft in `SUBMISSION.md`. |
| 2 | 60 s demo video | Devin drives; you supply pet videos | Plan is in "Demo video plan" below. Needs 2-3 clips of a real animal calling, the pet's name, and your call on the open decisions. |
| 3 | `SUBMISSION.md` placeholders | you | Team handle `@<your-handle>` and the video link/attachment. |
| 4 | GPU race lane — decide | you | Either `NEBIUS_API_KEY` in the gateway env + restart + `scripts/setup-openclaw.sh`, then test the race live (mock-tested only so far), or cut the race claim from the README/SUBMISSION copy. |
| 5 | Real microphone check | you | Mic capture has never run on real hardware; do one LISTEN take against a real animal before filming. |
| 6 | Cerebras support message | you | Drafted for `#hackathon-support` (queue_exceeded pattern + org TPM question), still unposted. |
| 7 | Post the drafts | you | X post, Reddit, Discord speed-bounty line — all in `SUBMISSION.md`. |
| 8 | Housekeeping | anyone | `shopper-run.png` in the repo root is a committed stray screenshot; the Dev D drafts sit in Trash. |
| 9 | Try your own pet video | you | The upload path is verified with a synthetic video only. Try one real clip (phone and desktop) before filming; it is the easiest way to get a good take. |

## Review follow-ups (M2.5)

A pre-submission review raised four objections. What we found and decided:

- **"Lands before the meow finishes" was false.** LISTEN records a fixed
  3 s window before anything is sent, and the first word then waits on a
  shared trial queue (measured 10-170 s, including OpenClaw retrying
  Cerebras 429s) plus the model's hidden thinking. The claim is now: once the
  model starts answering, the whole translation streams in within a fraction
  of a second. Decode time is the headline number; wait is shown apart.
- **The race compared different models on a non-GPU provider with guessed
  tokens.** The rival is now the same model (Kimi K3.1 Pro) at Nebius
  (GPU), routed through a second OpenClaw agent with the same workspace.
  Tokens come from the provider's usage report; estimates are labelled.
- **OpenClaw was a pass-through.** The workspace is now the only prompt,
  sessions are real (the agent hears replies), and the agent keeps per-pet
  memory with its own tools at session end. Measured on the live gateway:
  prompt 20,384 → 4,700-5,000 tokens after replacing the stock `AGENTS.md`
  and limiting tools and skills. K3.1 Pro cannot turn reasoning off; we
  request `low`. Hidden thinking went from 340 to 167-215 tokens per
  capture, but we have not isolated how much of that is the effort setting.
- **"It's just making it up."** Every interpretation now carries an
  `EVIDENCE` line citing the measurements that decided the class.

A (merged into the trunk from `redesign-objections`): server, `api.js`,
`app.js`, harness, agent workspace, setup script, README. The lane rename is
also done in `ribbon.js`, `telemetry.js`, `controls.js`, `captions.js`,
`captions.css` and `scripts/devd-smoke.mjs`. Contract changes are in the event
table below: `evidence`, `tokensEstimated`, `reasoningTokens`, `tpsEstimated`,
`intent:pet`, and lane `"groq"` renamed `"rival"`.

UI work from the review, all done on `main`: the evidence line in captions
and as a marker on the ribbon; decode time as the telemetry headline with
wait shown apart and `est.` on estimated rates; the pet name field; the
"Race a GPU" switch; and a start-screen sentence that makes no speed promise.

Demo video plan (60 s, 16:9, 1080p; proposed 22 Nov, 12:56 UTC, not yet agreed)

Devin drives the app and the edit; the user supplies real pet videos. The
video must read with the sound off (X autoplays muted), so the app's own
large captions and short on-screen labels carry it; the meows are a bonus.

| Time | Beat | What is on screen |
|---|---|---|
| 0:00-0:06 | Cold open | The user's pet video full frame, the animal calls, hard cut to Babble landing the translation in large type. No title card first. |
| 0:06-0:18 | It is measured | The same clip uploaded: ribbon paints while it plays, call brackets and pitch line settle, the verdict stamps in, the evidence line and its ribbon marker are held for two seconds, the snapshot card shows the frame that was sent. |
| 0:18-0:28 | It listens | A second, different call from the same animal: a different class and different evidence. |
| 0:28-0:40 | It remembers | A typed reply is voiced back as meows; the next call answers it. The pet is given its real name first, so the session starts with empty memory and the callback is caused on camera. |
| 0:40-0:52 | Speed | The decode readout, with wait shown beside it. The two-lane race is used only if a live take with both lanes finishing exists; otherwise this beat shows decode time on Cerebras alone plus the separately measured bounty figure, labelled as such. |
| 0:52-1:00 | End card | Wordmark, hosted demo URL, repo, `#KimiOnCerebras`. |

Rules for the edit:

- Live takes wherever the trial queue allows (`node scripts/cerebras-window.mjs`,
  start on `<- go`). A take that falls back keeps its REPLAY label in frame.
- Queue wait may be trimmed, but the wait figure stays visible in telemetry
  and the cut carries a small "queue wait trimmed" label. Never present
  replay timing as a live result, and never show a race that did not finish
  live on both lanes.
- Several takes are recorded per beat and the best real one is used; no
  model output is edited or re-typed.
- The mic path is not shown, because it has not been tested on hardware.

Capture, not yet proven end to end: frames from the browser over CDP
screencast (frames arrive; the frame rate under acknowledgement is not yet
measured), app audio tapped from the page's audio graph, assembled with
ffmpeg. Screen capture through ffmpeg/avfoundation hung on this machine,
probably on the Screen Recording permission. First step is a 10 s test
recording with picture and sound in step.

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
| `interpret:header` | A | `{ lane, vocal, mood, confidence, evidence }` (`confidence` 0..1 or `null`; `evidence` is the agent's one-line citation of the measurements that decided the class, or `null`) |
| `interpret:delta` | A | `{ lane, text, t, first, tps, tpsEstimated }` (`text` is utterance body only, header already stripped; `tps` is the running decode rate, always a chars/4 estimate while streaming) |
| `interpret:done` | A | `{ lane, text, queueMs, decodeMs, tokens, tps, tokensEstimated, reasoningTokens, replay }` (`tokens` are visible output tokens from the provider's usage report; `tokensEstimated` is true when no usage arrived and chars/4 was used; `reasoningTokens` are the model's hidden thinking tokens, or `null`) |
| `interpret:error` | A | `{ lane, reason: "timeout"\|"http"\|"network", status }` |
| `reply:sent` | A | `{ text }` |
| `vocalize:play` | A | `{ script, schedule, startedAt, totalMs }` (`schedule[i] = { tMs, durMs, type, shape, pitch, gloss }`) |
| `vocalize:error` | A | `{ reason }` |
| `intent:listen` | D | `{ secs }` |
| `intent:clip` | D | `{ file, species }` |
| `intent:file` | D, drop zone | `{ file }` (a `File`: audio, video or image) |
| `intent:media-clear` | snapshot card | `{}` (remove the uploaded picture) |
| `media:set` | A | `{ kind: "video" \| "photo", url, name, fromSec? }` |
| `media:frame` | A | `{ dataUrl, tMs, fromSec?, sent, demo }` (`tMs` is null for a portrait; `sent` means the picture goes to the model) |
| `media:clear` | A | `{}` |
| `intent:reply` | D | `{ text }` |
| `intent:race` | D | `{ on }` |
| `intent:pet` | D | `{ name }` (names the animal; A ends the current session so the agent saves its memory, then starts a new one) |
| `intent:cam` | D | `{ on }` |
| `intent:retry` | D | `{}` |
| `intent:start` | D | `{}` (start screen dismissed; audio is unlocked) |

`lane` is `"cerebras"` or `"rival"`. The rival lane only exists when race is on. It runs the same model (Kimi K3.1 Pro) on GPUs at Nebius, through a second OpenClaw agent with the same workspace, so both lanes get an identical prompt; its label comes from `/api/config` `rival.label`.

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
5. Race on: two lanes side by side with a winner flag (or "GPU lane offline").
6. Forced timeout (stop the gateway): error state is designed, retry works.
7. Keyboard only: every control reachable, focus visible.
8. `prefers-reduced-motion`: text appears whole, no looping motion.
9. No console errors.
