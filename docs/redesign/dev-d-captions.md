# Dev D: captions, race lanes, start screen, controls, responsive

Read [README.md](README.md) first. Your job is the payoff (the translation as
large type that the sound turns into), the first ten seconds, and every
control a person touches.

## Files you own

`public/captions.js`, `public/start.js`, `public/controls.js`,
`public/css/captions.css`, `public/css/start.css`, `public/css/controls.css`,
`public/vendor/`.

## References and what to take

| Repo | Take | Do not take |
|---|---|---|
| `codrops/TextCharacterAnimations` (MIT) | `js/variations/voiceNote.js` and `css/variations/voice-note.css`: a bar per letter that grows when the letter is "spoken", flickers like a level meter while it waits, then shrinks into its centre as the letter fades in a few characters later. Its `settings` block is the starting point for our timings (`lag: 5`, `grow: 0.1`, `shrink: 0.18`, `fade: 0.15`, `levels: [0.2, 0.8]`). `liveCaptions.js`: words arriving in bursts of one to three, and rows rolling up so the newest row is always the bottom one (`roll: 0.22`). The `show()` method on both for reduced motion. `js/gsap.min.js` and `js/SplitText.min.js` (GSAP 3.15) into `public/vendor/`. | The scroll wiring in `js/index.js`, ScrollSmoother, ScrollTrigger, Flip. |
| `thibautlfr/ocarina` (MIT) | `src/experience/ui/title-screen.ts`: a modal start screen (`role="dialog"`), a loading gauge that hands over to a start button which is disabled until ready, separate "Press Start" and "Tap to start" labels for pointer and touch, a key legend, a "Sound on" indicator, and a fade-out on start. | The pixel-art styling. |
| `argofowl/ferro-toggle` (MIT) | The `spring()` integrator for the race switch, so it overshoots and settles like a physical switch. | The liquid shader. |
| `MatthewGreenberg/skate-dog` (noncommercial, ideas only) | Rotating in-character status lines during a wait ("Hiding the bonus bones..."). | Any code. |
| `codrops/GooeyStickyMenu` (MIT) | Stretch only, after everything else: `js/goo.js` merges the menu into one liquid body. For us, an SVG goo filter (blur plus contrast) on the species switcher gets most of that. | Do not port the 854-line WebGL shader. |

Both Codrops text classes build one timeline from text that is fully known in
advance (`SplitText` once, then `play()`). Ours arrives token by token. So
port the mechanics and timings, not the classes as-is. Confirm GSAP's licence
terms at the URL in the file header before vendoring, keep the header intact,
and add lines to `THIRD_PARTY.md`.

## 1. `captions.js`

Mounted in `#captions`. One or two lanes.

**Layout.** Above the utterance, a header row in mono: vocal class, mood,
and confidence as a small labelled bar, for example
`SOLICITATION · impatient · 82%`. Below it, the utterance in the display
font at `--step-3`, in `--ink`, max about 22 characters per line on desktop.
A lane label ("Kimi K3.1 Pro on Cerebras") sits under the header.

**Incremental voice-note effect.**

- Keep an append-only list of characters. On each `interpret:delta`, wrap the
  new characters in spans and append a bar element for each, positioned over
  its letter as `voiceNote.js` does in `measure()`.
- Bar height: take it from the real loudness envelope, not the vowel
  heuristic. Map each character's index to a position along
  `features.envelope` (from the last `analysis` event) and use that value,
  scaled into the `levels` range. This is the visible link between the
  measured sound and the words.
- Timing per character: bar grows on arrival, flickers, then shrinks while
  the letter fades in after the lag. If deltas arrive faster than the
  animation, shorten the lag so the text never falls more than about 0.4s
  behind the stream. Speed is the point; the effect must not hide it.
- When a line fills, roll rows up as `liveCaptions.js` does.
- Bars use `--signal`.

**States.**

| State / event | Captions |
|---|---|
| `idle` | A one-line prompt in `--ink-2`: what to do next. |
| `listening`, `analysing` | The lane clears; a row of idle bars breathes. |
| `queued` | Rotating in-character lines per species, changing every 2.5s, plus the real elapsed seconds in mono. Cat: "Composing a complaint...", dog: "Too excited to form words...", infant: "Gathering breath...". Write six per species. |
| `interpret:header` | The header row pops in. |
| `interpret:delta` | The effect above. |
| `interpret:done` | Bars finish; if `replay`, show a REPLAY tag on the lane. |
| `interpret:error` | "Timed out after 12 s" (or the reason) with a Retry button that emits `intent:retry`. |
| `reply:sent` | The human line appears below in smaller type, right-aligned. |
| `vocalize:play` | Under it, the syllable glosses appear one at a time on `schedule[i].tMs`, for example `meow (dinner) · trill (soon)`. |
| `vocalize:error` | "Couldn't vocalize that" with a retry. |

**Race.** With race on, `#captions` splits into two equal lanes, Cerebras
left and Groq right in `--rival`, each running the same component from its
own lane's events. When the first lane finishes, flag it "finished first"
with its time; when both are done, show the margin. If the Groq lane errors
with status 501, show "Groq offline (no key)" in the lane, not an empty box.
Under 900px the lanes stack.

**Accessibility.** The animated element is `aria-hidden`; a visually hidden
`aria-live="polite"` paragraph receives the finished text, as the Codrops
`AGENTS.md` recommends. Under `prefers-reduced-motion`, append text directly
with no bars.

## 2. `start.js`

Mounted in `#start`, shown while `state` is `boot`.

- Wordmark, one sentence of what Babble does, and a species preview.
- A start button, disabled until fonts are ready (`document.fonts.ready`)
  and `/api/config` has answered. Label by input type: "Press Space to
  start" or "Tap to start".
- On start: call `unlock()` from `audio.js`, emit `intent:start`, fade out
  over `--dur-3`, and remove the dialog from the tab order.
- A key legend and a "Sound on" indicator in a corner.
- Enter and Space activate it; focus starts on the button.

## 3. `controls.js`

Mounted in `#controls`. Emits intents only; it does no work itself.

Three groups, left to right, labelled in plain words:

- **Listen.** A large primary button "Listen" with the duration (2, 3, 5 s)
  as a segmented control beside it. While `listening` it shows a countdown
  ring and is disabled; disabled in `queued` and `streaming` too.
- **Source.** "Try a sample" opens the five demo clips as a small menu of
  named buttons (not a native select). "Upload a clip" for a file. "Camera"
  as a toggle with an on state.
- **Options.** Species switcher (three segments, each in its own colour,
  calls `stage.setSpecies`), the Race switch (sprung, labelled "Race Groq"),
  and mute.

The reply field sits on its own row: an input "Say something back..." with a
send button. Disabled until the first translation is done. After sending it
shows a pending state until `vocalize:play` or `vocalize:error`.

Keys: `Space` listen (when focus is not in the input), `1` `2` `3` species,
`R` race, `M` mute, `L` log, `Esc` closes menus. Every control has hover,
focus-visible, active and disabled styles. Hit targets are at least 44px.

## 4. Responsive and finish

A owns the page grid; you own how your three modules behave inside it.

- Under 900px: captions drop to `--step-2`; controls become a sticky bottom
  bar with Listen as a full-width thumb button and the rest behind a "More"
  sheet; the start screen fits one viewport with no scroll.
- Check at 390x844 and 1450x736.

## Acceptance

- In the harness, text builds from bars into letters, stays within 0.4s of
  the stream, and rolls rows correctly on long output.
- Bar heights visibly differ between a loud and a quiet clip.
- A 10s queue shows rotating lines and a running count.
- Race shows two lanes, a winner flag and the margin; Groq without a key
  shows the offline message.
- The start button unlocks audio; nothing plays before it.
- Keyboard only: every control is reachable and operable, focus is always
  visible, and the reply input does not trigger the `Space` shortcut.
- Reduced motion: text appears whole.
- No console errors; `node --check` passes.

## Hand-offs

- A handles every intent you emit: agree any new intent with A first.
- C provides `unlock()` and `setMuted()`.
- B's `features.envelope` is what your bars read; it arrives on `analysis`.
