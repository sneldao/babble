# Babble — the interspecies interpreter

Point a microphone at your cat, dog, or infant. Babble measures what the
vocalization actually did — pitch contour, call count, energy envelope — and
an agent renders what it meant. Babble shows the wait before the answer and
how long it takes to stream. Talk back, and your
words are re-synthesized as species-shaped vocalizations. Babble remembers
each animal between sessions.

Built for the **Cerebras × Moonshot Kimi K3.1 Pro × OpenClaw Weekend
Hackathon**. All interpretation runs through an **OpenClaw** agent (`babble`)
whose backend model is **Kimi K3.1 Pro on Cerebras**.
Thank you to the Cerebras and Moonshot teams for the preview access.

**Hosted demo: https://sneldao.github.io/babble/** — the full experience,
playing the recorded real responses for each sample clip (labelled REPLAY).
For the live model, run it locally as below.

## Architecture

```
mic / clip ──▶ browser DSP (f0 contour, call segmentation, envelope, centroid)
                   │  structured acoustic JSON + optional still frame
                   ▼
            babble server (zero-dep node:http)
                   │  OpenAI-compatible, SSE streamed, one OpenClaw session per animal
                   ▼
      OpenClaw gateway :18789 /v1/chat/completions
                   │                                   │ (race on)
                   ▼                                   ▼
        agent `babble`                       agent `babble-gpu`
        Kimi K3.1 Pro @ Cerebras             Kimi K3.1 Pro @ Nebius (GPU)
                   │      same workspace: agent-workspace/      │
                   ▼                                            ▼
      streamed translation → captions + ribbon + decode-time readout
```

Talk-back path: your text → `openclaw/babble` renders a vocalization script
(syllables with pitch envelopes) → WebAudio synthesizes it aloud.

## What OpenClaw does here

- **The workspace is the agent.** `agent-workspace/SOUL.md` holds the persona,
  the three message contracts (`LIVE CAPTURE`, `VOCALIZE`, `SESSION END`) and
  the decision rules distilled from `ethology/`. The server sends no system
  prompt of its own.
- **Real sessions.** Each animal gets an OpenClaw session
  (`x-openclaw-session-key`), so the agent hears your replies and the animal
  answers in context ("dinner is at six" → the next meow is a protest about
  six o'clock).
- **Per-pet memory.** When a session ends (species switch, renaming the pet,
  or closing the tab), the agent is sent `SESSION END` and uses its `write`
  and `edit` tools to update `memory/pets/<pet>.md` with durable observations.
  The next session for that pet starts with those notes. Tools are allowed
  only for this step and only inside the workspace, so live captures stay a
  single fast model call.
- **Model routing.** The race lane is a second agent, `babble-gpu`, with the
  same workspace on a GPU provider, so both lanes see an identical prompt.

## Why the features, not the waveform

The browser does the DSP: autocorrelation f0 tracking, call segmentation
(>250 ms gaps), contour shape classification, energy envelope and spectral
centroid. That summary — not raw audio — is what the agent reads, mapped onto
documented vocal classes (solicitation, protest, alarm, play…, see
`agent-workspace/ethology/`). Every interpretation carries an `EVIDENCE` line
citing the measurements that decided it (`rising contour; 2 calls; median f0
600 Hz`), shown next to the translation, so you can see the sound drive the
words. Change the sound and the class changes with it.

## Setup

```bash
export CEREBRAS_API_KEY=csk-...
export NEBIUS_API_KEY=...            # optional: GPU race lane (Nebius Token Factory)
./scripts/setup-openclaw.sh          # providers, babble + babble-gpu agents, gateway token
node server.mjs                      # http://localhost:4319
```

Requires OpenClaw (`npm i -g openclaw`), Node ≥ 20, a Cerebras API key.

For a fresh demo setup, the script allows both models when `NEBIUS_API_KEY`
is set. On an existing gateway, add `nebius/moonshotai/Kimi-K3.1-Pro` to
`agents.defaults.modelPolicy.allow` without dropping existing entries, and set
`compat.supportsUsageInStreaming: true` on the Nebius model. The allowlist
permits Babble's `x-openclaw-model` override; a rejection surfaces as a 400
upstream error in the `/api/compare` event stream. The compat flag makes
OpenClaw request usage from Nebius; Babble already requests it from OpenClaw.

## Demo flow

1. Pick a species (cat / dog / infant) — or a demo clip — and name your pet.
2. LISTEN captures 3 s, the spectrogram + f0 contour draw in real time. Or
   bring your own: upload or drop in a video of your pet (or a sound file).
   Babble plays it, analyses the loudest 12 s, and sends the frame from the
   loudest moment with the measurements. A photo alone is kept as a portrait
   and sent with each later sound.
3. The interpretation streams in — vocal class, mood, confidence, the
   evidence behind it, and the utterance.
4. Reply in the box — Babble vocalizes it back. Keep the mic on: the animal
   answers in the same OpenClaw session, and remembers you next time.
5. Flip on **race** — the same payload runs through Kimi K3.1 Pro on Nebius
   GPUs alongside Cerebras, and the two translations compete on decode time.

## Replay fallback and record mode

Live requests get a 12 s first-token budget. If a demo clip misses it, the UI
plays that clip's recorded real response from `public/replays/`, labelled
REPLAY; mic and file captures show an error with a retry button instead. To
re-record the fixtures, run `BABBLE_RECORD=1 node server.mjs` and play each
demo clip (the budget rises to 180 s in this mode).

## Notes on speed

- The headline figure is **decode time**: measured in the browser from the
  first non-empty content chunk until the response stream closes. It is not
  provider-side compute time; it includes transport and stream finalization.
- **Wait** (request to first content chunk) is shown separately and never folded into
  speed. It covers the preview endpoint's queue, OpenClaw's retries while
  that queue is busy, and the model's hidden thinking: Kimi K3.1 Pro always
  reasons before answering (Babble asks for the lowest effort, `low`).
- The Kimi K3.1 Pro endpoint was a private preview shared by every hackathon
  participant, so the wait before the first word varied with load during the
  event, from a few seconds to a couple of minutes. That reflects event
  capacity, not the model or the hardware, and it is why Babble shows wait
  apart from decode. In about ten live runs on 22 Nov with the default 12 s
  budget, decode took 0.17-1.04 s.
- When the final usage chunk arrives, Babble subtracts reported reasoning
  tokens from completion tokens and shows the reasoning count separately.
  Otherwise it estimates output tokens from characters divided by four and
  labels the rate `est.`. Both lanes returned provider-reported counts in the
  completed live race, but usage may be absent on other runs. Live rates are
  estimates until the stream finishes.
- One live two-lane race completed on 22 Nov, with longer test-only timeouts
  and at a moment of heavy load on the preview: Cerebras waited 115.42 s and
  streamed in 6.15 s; Nebius waited 16.98 s and streamed in 0.87 s. Both
  would have missed the app's default 12 s first-content budget. It is a
  single take, not a benchmark of either provider, and we have not repeated
  it under normal load.

The redesign plan, current status and the review follow-ups live in
`docs/redesign/README.md`.

## Honesty notes

- Babble does not claim scientific decoding. The acoustic measurements are
  real and the vocal classes are grounded in published ethology (meow/bark
  classes do differ in pitch, contour and repetition), but the voice is a
  performance — a very fast, very fun one.
- Confidence is meant to be honest: thin data lowers it, and infant mode
  stays in the 0.40–0.70 band.
