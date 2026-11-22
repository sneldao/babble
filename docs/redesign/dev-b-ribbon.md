# Dev B: sound ribbon, DSP, speed telemetry

Read [README.md](README.md) first. Your job is to make the real signal
processing, which is Babble's actual differentiator, the largest and most
legible thing on screen, and to make the speed claim provable at a glance.

## Files you own

`public/acoustics.js`, `public/ribbon.js`, `public/telemetry.js`,
`public/css/ribbon.css`, `public/css/telemetry.css`.

## References and what to take

| Repo | Take | Do not take |
|---|---|---|
| `rauchg/vinyl` (MIT) | The principle in `src/render.js` and the README's "Draw" step: the picture is drawn from the audio data itself, lit by how strongly it is modulated. Every mark on the ribbon must come from a measured value. | Its DSP (`cut.js`, `dsp.js`): that is record-cutting maths we do not need. |
| `MatthewGreenberg/beat-machine` (no licence, ideas only) | `src/scene/Screen.jsx`: content is drawn at full resolution into an offscreen mask canvas, then resampled one dot per grid cell so text reads as a dot-matrix display; and a staged boot (backlight, then content, then pixels settling). | Any code. Reimplement in Canvas2D. |
| `rock-biter/procedural-eye` (no licence, ideas only) | The HUD language of the live demo: thin corner brackets, tick marks and small mono readouts framing one subject. | Any code. |

## 1. `acoustics.js`

Keep every field `analyzeBuffer` returns today; `server.mjs` reads them.

Add, per the README contract:

- `track: { hopMs, f0, rms }`, one entry per analysis frame, `f0` 0 when
  unvoiced. Today the contour drops unvoiced frames, so it cannot be aligned
  to time; the track fixes that.
- `startMs` and `endMs` on each segment. The segmentation loop already walks
  frames in order, so carry the frame index.

Change `captureMic(secs)`:

- Use `getCtx()` from `audio.js`; do not create or close a context.
- Create an `AnalyserNode` (fftSize 2048) on the mic source and return
  `{ analyser, startedAt, done }` immediately, where `done` resolves to the
  `AudioBuffer`. This is what lets the ribbon draw while recording.
- Replace the deprecated `ScriptProcessor` with an `AudioWorklet` if it is
  quick; otherwise keep it and leave a note. Not a blocker.

## 2. `ribbon.js`

One canvas filling `#ribbon`, sized to `devicePixelRatio`, redrawn on
resize. It replaces the three old canvases.

**Axes.** X is time across the capture. Y is frequency, log scale, 80 Hz to
4 kHz. Ticks at 100, 200, 500, 1k, 2k, 4k in mono type; time ticks every
0.5s.

**Live phase** (`capture:start` until `analysis`): each animation frame, read
`analyser.getByteFrequencyData` and paint one column at the playhead. Map
magnitude to ink density on the paper ground, with the top of the range in
`--signal`. A thin playhead line sweeps left to right over `durationMs`.
For `source: "file"` there is no analyser: skip to the next phase.

**Settled phase** (`analysis`): redraw the whole capture from the buffer so
the picture is exact. Compute the columns with an FFT, in chunks across
frames so the main thread never stalls; this replaces the per-pixel DFT loop
in the old `drawSpectrogram`. Then overlay:

- The pitch line from `features.track.f0`, drawn on the same Hz axis so it
  sits on the fundamental in the spectrogram. Break the line where unvoiced.
  Stroke in `--ink`, 2px, with a `--signal` dot at the median.
- A bracket under each segment from `startMs` to `endMs`, labelled
  `call 2 · 420 ms · arch · 558 Hz`.
- The loudness envelope from `features.track.rms` as a thin filled strip
  along the bottom edge.
- A species range band: a faint horizontal band for the typical range
  (`SPECIES[id].rangeHz`), so a judge sees the call land inside it.

**Arrival marks.** This is the proof of the speed claim.

- On the first `interpret:delta` with `first: true` for the Cerebras lane,
  drop a flag on the time axis at `t - capture.startedAt`, labelled
  "first word".
- On `interpret:done`, drop "last word".
- If a mark falls beyond the end of the capture, extend the axis to the
  right with a hatched "after the sound" zone, so the picture stays truthful
  when we are slow.
- With race on, the rival lane gets its own marks in `--rival`.
- On a replay, draw the marks hollow and label them "replay".

**Other states.** `idle`: an empty ruled strip with the axes and one line of
mono copy ("waiting for a sound"), never a blank box. `error`: keep whatever
was captured.

**Talk-back.** On `vocalize:play`, draw the outgoing syllables on the same
axes from `schedule` (pitch curve from `shape` and `pitch`, width from
`durMs`), each labelled with its `gloss`. The ribbon then shows both
directions of the conversation.

## 3. `telemetry.js`

A small instrument in `#telemetry`, mono type, drawn as a dot-matrix display
(the beat-machine idea, reimplemented): render the text to an offscreen
canvas, then resample to a grid of dots.

Shows, in this order:

- Decode time, large: `0.31 s` from `interpret:done.decodeMs`, the time
  from first word to last. This is the headline figure; it is measured
  exactly, unlike tokens.
- Tokens per second, smaller, live from `interpret:delta.tps` and replaced on
  `interpret:done`. Suffix `est.` whenever `tpsEstimated` / `tokensEstimated`
  is true. Never show a rate without that suffix when it is estimated.
- `wait 4.2 s · decode 0.31 s` from `interpret:done`. Label the first figure
  "wait", not "queue": it holds the shared trial endpoint's queue and
  retries plus the model's hidden thinking (`reasoningTokens`, shown as
  `+ 167 thinking tokens` when not null). Never fold it into the speed figure.
- While `queued`: the elapsed count, and "wait" lit.
- On replay: the word REPLAY and no tok/s figure.
- With race on: a second row for the rival lane, labelled from `/api/config` `rival.label`.

On first mount, run a short boot (dots fill in over about 0.8s). Under
reduced motion, show it settled.

## Reduced motion and resize

`prefers-reduced-motion`: no sweeping playhead and no boot; draw settled
states directly. On resize, redraw from the stored features and marks.

## Acceptance

- In the harness, `cat-pleading` shows a clearly visible spectrogram, the
  pitch line sitting on the fundamental, correct call brackets, and both
  arrival marks. A screenshot at 1450px must be readable without zooming.
- `dog-bark` shows three separate call brackets.
- A mic capture paints live while recording.
- The settled redraw does not block input (typing in the reply box stays
  responsive during it).
- Existing feature fields are byte-for-byte what the old function returned
  for the five demo clips. Check this with a quick before/after dump.
- No console errors; `node --check` passes.

## Hand-offs

- A consumes `captureMic` and `analyzeBuffer`: tell A when their signatures
  are final.
- C reads `features.track.rms` for the mouth: the field shape is fixed in the
  README.
