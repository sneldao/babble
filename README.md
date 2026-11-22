# Babble — the interspecies interpreter

Point a microphone at your cat, dog, or infant. Babble measures what the
vocalization actually did — pitch contour, call count, energy envelope — and
an agent renders what it meant. Once the model starts answering, the whole
translation streams in within a fraction of a second. Talk back, and your
words are re-synthesized as species-shaped vocalizations. Babble remembers
each animal between sessions.

Built for the **Cerebras × Moonshot Kimi K3.1 Pro × OpenClaw Weekend
Hackathon**. All interpretation runs through an **OpenClaw** agent (`babble`)
whose backend model is **Kimi K3.1 Pro on Cerebras**.

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
export NEBIUS_API_KEY=...            # optional: the GPU race lane
./scripts/setup-openclaw.sh          # providers, babble + babble-gpu agents, gateway token
node server.mjs                      # http://localhost:4319
```

Requires OpenClaw (`npm i -g openclaw`), Node ≥ 20, a Cerebras API key.

## Demo flow

1. Pick a species (cat / dog / infant) — or a demo clip — and name your pet.
2. LISTEN captures 3 s, the spectrogram + f0 contour draw in real time.
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

- The headline figure is **decode time**: first word to last, measured in the
  browser. It is exact.
- **Wait** (request to first word) is shown separately and never folded into
  speed. It covers the shared trial endpoint's queue, OpenClaw's retries when
  that queue is full, and the model's hidden thinking: Kimi K3.1 Pro always
  reasons before answering (Babble asks for the lowest effort, `low`).
- Token counts come from the provider's usage report: visible output tokens,
  with hidden thinking tokens reported separately. When a provider sends no
  usage, the figure falls back to characters ÷ 4 and is labelled `est.`.
- Measured on 22 Nov through the gateway: 10-170 s of wait before the first
  word, mostly the overloaded trial queue, then 0.25-0.6 s to decode the
  whole reply. With the 12 s budget, demo clips usually fall back to REPLAY
  (see above).

The redesign plan, current status and the review follow-ups live in
`docs/redesign/README.md`.

## Honesty notes

- Babble does not claim scientific decoding. The acoustic measurements are
  real and the vocal classes are grounded in published ethology (meow/bark
  classes do differ in pitch, contour and repetition), but the voice is a
  performance — a very fast, very fun one.
- Confidence is meant to be honest: thin data lowers it, and infant mode
  stays in the 0.40–0.70 band.
