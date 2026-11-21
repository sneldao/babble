# Babble — the interspecies interpreter

Point a microphone at your cat, dog, or infant. Babble measures what the
vocalization actually did — pitch contour, call count, energy envelope — and
an agent renders what it meant, fast enough that the translation lands before
the meow finishes. Talk back, and your words are re-synthesized as
species-shaped vocalizations.

Built for the **Cerebras × Moonshot Kimi K3.1 Pro × OpenClaw Weekend
Hackathon**. All interpretation runs through an **OpenClaw** agent (`babble`)
whose backend model is **Kimi K3.1 Pro on Cerebras** — that's what makes the
conversation real-time instead of a loading spinner.

## Architecture

```
mic / clip ──▶ browser DSP (f0 contour, call segmentation, envelope, centroid)
                   │  structured acoustic JSON + optional still frame
                   ▼
            babble server (zero-dep node:http)
                   │  OpenAI-compatible, SSE streamed
                   ▼
      OpenClaw gateway :18789 /v1/chat/completions
                   │  agent target: openclaw/babble
                   ▼
        Kimi K3.1 Pro @ Cerebras (moonshotai-kimi-k3.1-pro-trial)
                   │
                   ▼
      streamed translation → transcript + avatar + tok/s meter
```

Talk-back path: your text → `openclaw/babble` renders a vocalization script
(syllables with pitch envelopes) → WebAudio synthesizes it aloud.

## Why the features, not the waveform

The browser does the DSP: autocorrelation f0 tracking, call segmentation
(>250 ms gaps), contour shape classification, energy envelope and spectral
centroid. That summary — not raw audio — is what the agent reads, mapped onto
documented vocal classes (solicitation, protest, alarm, play…, see
`agent-workspace/ethology/`). It's honest signal processing with a persona on
top, not a random-number generator wearing a lab coat.

## Setup

```bash
export CEREBRAS_API_KEY=csk-...
./scripts/setup-openclaw.sh        # onboard, provider plugin, gateway token, babble agent
node server.mjs                     # http://localhost:4319
```

Requires OpenClaw (`npm i -g openclaw`), Node ≥ 20, a Cerebras API key.

## Demo flow

1. Pick a species (cat / dog / infant) — or a demo clip.
2. LISTEN captures 3 s, the spectrogram + f0 contour draw in real time.
3. The interpretation streams in — vocal class, mood, confidence, utterance.
4. Reply in the box — Babble vocalizes it back. Keep the mic on: the animal
   answers in-session (OpenClaw keeps the conversation context).

## Honesty notes

- Babble does not claim scientific decoding. The acoustic measurements are
  real and the vocal classes are grounded in published ethology (meow/bark
  classes do differ in pitch, contour and repetition), but the persona
  rendering is a product — a very fast, very fun one.
- Infant mode stays deliberately low-confidence.
