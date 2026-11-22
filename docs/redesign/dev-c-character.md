# Dev C: character, audio bus, talk-back voice, UI sounds

Read [README.md](README.md) first. Your job is a character that is visibly
alive and listening, three species that are actually different animals, and
sound that does not feel like a raw oscillator.

## Files you own

`public/character.js`, `public/audio.js`, `public/synth.js`, `public/sfx.js`,
`public/css/character.css`.

## References and what to take

| Repo | Take | Do not take |
|---|---|---|
| `krisyangdev/jelly` (MIT) | `src/face.js`: the `PAINT` table of Canvas2D face parts (`eyeOpen`, `eyeSurprised`, `eyeSquintL/R`, `eyeHappy`, `eyeSleepy`, `eyeDizzy`, highlights, `cheek` blush, whisker cheeks, `mouthCat`, `mouthBear`, `mouthHappy`, `mouthSurprised`, `mouthSleepy`); the `EXPR` table; the blink (0.08s, every 2 to 5s, idle only); the "pop" scale when the expression changes (0.15s, peak 1.25); eye tracking with exponential smoothing; blush that decays. `src/audio.js`: `initAudio` (master gain, compressor, generated 0.8s reverb impulse, wet send), the voice cap in `claim`, and the helper shapes `chain`, `puff`, `thump`, `tone`. | The three.js parts: the texture atlas, `setCell`, `place`, the soft-body physics and felt shaders. The paint functions are plain Canvas2D and port directly. |
| `thibautlfr/ocarina` (MIT) | `src/experience/audio/vibrato.ts`: an LFO on `detune` that starts after a delay and fades in over 0.2s, applied only to notes long enough to hear it. | The sampler. |
| `argofowl/ferro-toggle` (MIT) | From `index.html`: the `spring(s, target, w, z, dt)` integrator, and the UI sound recipes `bubble`, `grain`, `sweep`, `sub` with the `SFX.flip` pattern of layering two or three of them per event. | The raymarched liquid. |
| `MatthewGreenberg/skate-dog` (noncommercial, ideas only) | The loader idea: one progress cue that fills the brand shape. | Any code. |

Port with a header comment naming the source and author, and add a line to
`THIRD_PARTY.md`.

## 1. `audio.js`

A's scaffold ships a minimal version; replace it with the real one, keeping
the exports in the README (`getCtx`, `unlock`, `getOut`, `playBuffer`,
`decode`).

- Master chain from jelly: `getOut()` gain into a compressor into the
  destination, plus a convolver send with the generated impulse. Keep the
  wet level low for clip playback (the room should hear the real animal
  clearly) and higher for synth and UI sounds: expose two inputs,
  `getOut()` (dry-ish) and `getFxOut()` (with the room).
- `playBuffer(buf)`: source into an `AnalyserNode` (fftSize 2048) into
  `getOut()`; return `{ analyser, startedAt: performance.now(), durationMs }`.
- Stay suspended until `unlock()`; every function is a no-op before that.

## 2. `character.js`

A `<canvas>` in `#character`, redrawn every frame from a small state object.
Canvas2D, no three.js.

**Three species, three silhouettes.** Draw each body as its own path set.
The current build draws one cat and restyles it; do not repeat that.

- Cat: round head, upright triangular ears, whisker cheeks, `mouthCat`.
- Dog: longer head with a muzzle, floppy ears that hang and swing, a nose,
  `mouthBear`-style mouth, tongue on `happy`.
- Infant: round head, no animal ears, a hair tuft, small ears at the sides,
  simple mouth; no whiskers.

Fill with `--signal` (read the computed value on `species`), features in
`--ink`. Use the ferro `spring()` for ears, head tilt and squash so nothing
moves linearly.

**Expressions.** Port jelly's `EXPR` table. Add a `listening` pose (ears
forward, eyes wide, slight lean toward the ribbon) and a `waiting` pose.

**Behaviour by stage event:**

| Event | Behaviour |
|---|---|
| `state: idle` | Blink, breathe (slow 2% squash), eyes follow the pointer with smoothing. After 20s with no input, `sleepy`, wake on any event. |
| `capture:start` | `listening`. Mouth opening follows the analyser's level each frame (RMS of `getByteTimeDomainData`), with a fast attack and slower release, so the character appears to make the sound. Ears twitch on level peaks. |
| `analysis` | A single nod. |
| `state: queued` | `waiting`: head tilts, one ear cocked, tail or tuft idles. This is the wait, so it must stay alive for as long as it lasts. |
| `interpret:header` | Map to an expression with a pop: `protest`, `distress` to squint; `alarm` to surprised; `solicitation`, `hunger`, `attention` to surprised then happy; `greeting`, `play` to happy; `contentment` to sleepy; unknown to idle. Blush scales with `confidence`. |
| `interpret:delta` | Small mouth movement per delta while "speaking". |
| `interpret:done` | Hold the expression 2s, then idle. |
| `interpret:error` | `dizzy` for 1.5s, then idle. |
| `vocalize:play` | Turn toward the sound; ears perk on each syllable at `schedule[i].tMs`; react at the end (cat: slow blink; dog: happy; infant: surprised). |
| `species` | Squash out, swap silhouette, spring in. |

Under `prefers-reduced-motion`: keep expression changes and blinking, drop
breathing, springs and pointer tracking.

## 3. `synth.js`

Keep `playScript(script)` and the script format the server produces. Change:

- Use `getCtx()` and connect to `getFxOut()`; remove `window._babbleCtx`.
- Return `{ startedAt, totalMs, schedule }` with one schedule entry per
  syllable (`tMs`, `durMs`, `type`, `shape`, `pitch`, `gloss`).
- Add ocarina's delayed vibrato on syllables longer than about 0.35s.
- Per-type character: two detuned oscillators for `meow`, `whine`, `cry`;
  a noise burst at the onset of `bark` and `yip`; noise only for `hiss`.
  Two formant bandpasses in parallel instead of one.
- Respect jelly's voice cap so overlapping replies cannot stack.

## 4. `sfx.js`

Short synthesized UI sounds, built from the ferro recipes, all through
`getFxOut()`, all quiet. Subscribe to the stage yourself:

- `intent:start`: a three-note motif in the species' voice (a tiny rising
  meow), which proves sound is on. Take the idea from ocarina's start motif.
- `capture:start`: a soft tick. `analysis`: a low thump.
- First `interpret:delta`: a small rising chirp. `interpret:error`: a dull
  two-note fall.
- `species`: a pop pitched per species. `intent:race`: a switch click.

Export `setMuted(bool)`; D adds the mute control.

## Acceptance

- In the harness, all three species are recognisably different animals in a
  still screenshot.
- During `cat-pleading`, the mouth visibly follows the meow.
- A 10s queued state never looks frozen.
- Each `VOCAL` class in the table produces its expression.
- Talk-back sounds like a voiced animal call through a room, not a beep, and
  the character reacts on each syllable.
- No audio plays before `unlock()`. One `AudioContext` exists (check
  `chrome://media-internals` or count constructions).
- Holds 60fps on a laptop; no console errors; `node --check` passes.

## Hand-offs

- A imports `playBuffer`, `decode`, `playScript`: tell A when signatures are
  final (they must match the README).
- B's `captureMic` uses your `getCtx()`.
- D calls `unlock()` from the start button and `setMuted` from the mute key.
