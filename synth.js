// Babble vocalizer — Dev C (docs/redesign/dev-c-character.md §3).
// Renders the agent's vocalization script as audio. Script format unchanged
// from the server; playScript returns { startedAt, totalMs, schedule } with
// one entry per syllable, which A forwards as vocalize:play.
// Delayed vibrato ported from thibautlfr/ocarina
// `src/experience/audio/vibrato.ts` (MIT, © Thibaut L.): LFO on detune that
// starts after a delay and fades in over 0.2s, only on notes long enough.
// Voice cap pattern from krisyangdev/jelly `src/audio.js` (MIT).

import { getCtx, getFxOut } from "./audio.js";

const MAX_VOICES = 8;
let voices = 0;
function claim(seconds) {
  if (voices >= MAX_VOICES) return false;
  voices++;
  setTimeout(() => { voices--; }, seconds * 1000 + 80);
  return true;
}

// ocarina constants
const MIN_VIBRATO_LENGTH = 0.15, VIBRATO_FADE_IN = 0.2;
function addVibrato(c, detune, noteTime, noteDur, { delay, rate, depth }, stopAt) {
  if (depth === 0 || noteDur < delay + MIN_VIBRATO_LENGTH) return;
  const start = noteTime + delay;
  const lfo = c.createOscillator(); lfo.frequency.value = rate;
  const gain = c.createGain(); gain.gain.value = 0;
  lfo.connect(gain).connect(detune);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(depth, start + VIBRATO_FADE_IN);
  lfo.start(start); lfo.stop(stopAt);
  lfo.onended = () => gain.disconnect();
}

// shared looping noise buffer
let noiseBuf = null;
function noise(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  return src;
}

// two formant bandpasses in parallel (brief §3)
function formants(c, f1, f2, q1 = 4, q2 = 5) {
  const a = c.createBiquadFilter(); a.type = "bandpass"; a.frequency.value = f1; a.Q.value = q1;
  const b = c.createBiquadFilter(); b.type = "bandpass"; b.frequency.value = f2; b.Q.value = q2;
  const mix = c.createGain();
  a.connect(mix); b.connect(mix);
  return { a, b, mix };
}

const FORMANTS = {
  meow: [900, 1800], trill: [1100, 2200], chirp: [1300, 2600],
  hiss: [2600, 4200], bark: [500, 1100], yip: [800, 1700],
  whine: [500, 1400], cry: [600, 1500], gurgle: [350, 900],
};

// one syllable: pitch envelope + per-type voicing + formant colour + vibrato
export function playSyllable(s, at = 0) {
  const c = getCtx();
  const t0 = c.currentTime + at;
  const dur = Math.min(1.4, Math.max(0.08, s.dur || 0.3));
  const base = s.pitch || 500;
  const vol = Math.min(1, Math.max(0.05, s.intensity || 0.6)) * 0.5;
  if (!claim(dur + 0.2)) return dur;

  const type = s.type || "meow";
  const [f1, f2] = FORMANTS[type] || [900, 1800];
  const fm = formants(c, f1, f2, type === "hiss" ? 0.7 : 4, type === "bark" ? 2.5 : 5);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.05, dur * 0.2));
  g.gain.setValueAtTime(vol, t0 + dur * 0.75);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  fm.mix.connect(g).connect(getFxOut());

  const voiced = type !== "hiss";
  const oscs = [];
  if (voiced) {
    // per-type character: two detuned oscillators for meow/whine/cry;
    // noise burst at the onset of bark/yip
    const nOsc = ["meow", "whine", "cry"].includes(type) ? 2 : 1;
    for (let i = 0; i < nOsc; i++) {
      const o = c.createOscillator();
      o.type = "triangle";
      o.detune.value = i * (type === "meow" ? 14 : 9) - (nOsc === 2 ? 7 : 0);
      // pitch envelope (same shapes as before)
      const steps = 64;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        let f = base;
        switch (s.shape) {
          case "rising": f = base * (0.75 + 0.5 * u); break;
          case "falling": f = base * (1.3 - 0.55 * u); break;
          case "arch": f = base * (0.85 + 0.4 * Math.sin(Math.PI * u)); break;
          case "warble": f = base * (1 + 0.12 * Math.sin(2 * Math.PI * 6 * u)); break;
        }
        f *= 1 + 0.015 * Math.sin(2 * Math.PI * 5 * u + 1 + i); // natural jitter
        o.frequency.setValueAtTime(f, t0 + (dur * k) / steps);
      }
      // ocarina vibrato on syllables longer than ~0.35s
      addVibrato(c, o.detune, t0, dur, { delay: 0.18, rate: 5.5, depth: 22 }, t0 + dur);
      o.connect(fm.mix);
      o.start(t0); o.stop(t0 + dur + 0.05);
      oscs.push(o);
    }
  }
  if (type === "hiss" || type === "bark" || type === "yip") {
    const n = noise(c);
    const ng = c.createGain();
    const onset = type === "hiss" ? dur : Math.min(0.09, dur * 0.3);
    ng.gain.setValueAtTime(0, t0);
    ng.gain.linearRampToValueAtTime(vol * (type === "hiss" ? 0.9 : 0.7), t0 + 0.008);
    if (type !== "hiss") ng.gain.exponentialRampToValueAtTime(0.001, t0 + onset);
    else ng.gain.setValueAtTime(vol * 0.9, t0 + dur * 0.7), ng.gain.linearRampToValueAtTime(0, t0 + dur);
    n.connect(ng).connect(fm.mix);
    n.start(t0, Math.random() * 0.3); n.stop(t0 + (type === "hiss" ? dur : onset) + 0.05);
  }
  return dur;
}

export function playScript(script) {
  const c = getCtx();
  let at = 0;
  const schedule = script.map((s) => {
    const d = playSyllable(s, at);
    const entry = {
      tMs: at * 1000, durMs: d * 1000,
      type: s.type, shape: s.shape, pitch: s.pitch, gloss: s.gloss,
    };
    at += d + 0.09;
    return entry;
  });
  return { startedAt: performance.now(), totalMs: at * 1000, schedule };
}
