// Babble UI sounds — Dev C (docs/redesign/dev-c-character.md §4).
// Sound recipes (bubble, grain, sweep, sub) and the layered-per-event SFX
// pattern ported from argofowl/ferro-toggle `index.html` (MIT, © argofowl).
// Start-motif idea from thibautlfr/ocarina (MIT). All through getFxOut(),
// all quiet; no-ops until audio is unlocked.

import { getCtx, getFxOut } from "./audio.js";
import { stage } from "./stage.js";

let muted = false;
export function setMuted(m) { muted = !!m; }

let noiseBuf = null;
function noiseBuffer(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function noiseSrc(c, t, dur) {
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c);
  n.start(t, Math.random() * 0.3);
  if (dur !== undefined) n.stop(t + dur + 0.05);
  return n;
}
function envelope(c, t, attack, peak, decay) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(getFxOut());
  return g;
}
const rnd = (a, b) => a + Math.random() * (b - a);

// ferro recipes
function bubble(t, f, dur, amp) {
  const c = getCtx(), o = c.createOscillator(), v = envelope(c, t, 0.002, amp, dur);
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * (1.5 + Math.random() * 0.5), t + dur);
  o.connect(v); o.start(t); o.stop(t + dur + 0.05);
}
function grain(t, f, q, dur, amp) {
  const c = getCtx(), n = noiseSrc(c, t, dur), bp = c.createBiquadFilter(), v = envelope(c, t, 0.0015, amp, dur);
  bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
  n.connect(bp); bp.connect(v);
}
function sweep(t, type, f0, f1, dur, amp, attack) {
  const c = getCtx(), n = noiseSrc(c, t, dur), f = c.createBiquadFilter(), v = envelope(c, t, attack, amp, dur - attack);
  f.type = type; f.Q.value = 0.9;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  n.connect(f); f.connect(v);
}
function sub(t, f0, f1, dur, amp, attack) {
  const c = getCtx(), o = c.createOscillator(), v = envelope(c, t, attack, amp, dur);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(v); o.start(t); o.stop(t + attack + dur + 0.05);
}
function tone(t, type, f0, f1, dur, amp, attack = 0.01) {
  const c = getCtx(), o = c.createOscillator(), v = envelope(c, t, attack, amp, dur);
  o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  o.connect(v); o.start(t); o.stop(t + dur + 0.05);
}

// species voice for the start motif: a tiny rising meow in the animal's range
const MOTIF = {
  cat:    [520, 660, 780],
  dog:    [300, 380, 460],
  infant: [420, 500, 560],
};

const SFX = {
  "intent:start"(detail, species) {
    const t = getCtx().currentTime;
    const [a, b, c2] = MOTIF[species] || MOTIF.cat;
    // three-note rising motif in the species' voice — proves sound is on
    tone(t, "triangle", a, a * 1.06, 0.16, 0.16);
    tone(t + 0.18, "triangle", b, b * 1.06, 0.16, 0.18);
    tone(t + 0.36, "triangle", c2, c2 * 1.12, 0.3, 0.2);
    bubble(t + 0.36, c2 * 1.4, 0.14, 0.1);
    sweep(t, "bandpass", 600, 2200, 0.5, 0.03, 0.2);
  },
  "capture:start"() { // soft tick
    const t = getCtx().currentTime;
    grain(t, 1900, 0.7, 0.008, 0.07);
    sub(t, 240, 190, 0.08, 0.09, 0.003);
  },
  analysis() { // low thump
    sub(getCtx().currentTime, 110, 70, 0.14, 0.16, 0.004);
  },
  "interpret:delta"(d, species, seen) {
    if (seen) return; // first delta only: small rising chirp
    bubble(getCtx().currentTime, rnd(620, 780), 0.08, 0.09);
  },
  "interpret:error"() { // dull two-note fall
    const t = getCtx().currentTime;
    tone(t, "triangle", 320, 300, 0.16, 0.14);
    tone(t + 0.2, "triangle", 210, 190, 0.26, 0.14);
  },
  species(d) { // pop pitched per species
    const t = getCtx().currentTime;
    const f = { cat: 640, dog: 340, infant: 520 }[d.species] || 500;
    bubble(t, f, 0.12, 0.14);
    sub(t, f * 0.5, f * 0.4, 0.1, 0.1, 0.003);
  },
  "intent:race"() { // switch click
    const t = getCtx().currentTime;
    grain(t, 4200, 1.2, 0.012, 0.16);
    sub(t, 120, 70, 0.1, 0.2, 0.004);
  },
};

export function mount(_el, st) {
  const seen = new WeakSet();
  const unsubs = [];
  const route = (type) => (detail) => {
    if (muted) return;
    if (!getCtx) return;
    try { SFX[type]?.(detail, st.species, seen.has(detail) ? true : (seen.add(detail), false)); }
    catch (e) { console.error("[sfx]", type, e); }
  };
  for (const type of Object.keys(SFX)) unsubs.push(st.on(type, route(type)));
  return () => { for (const u of unsubs) u(); };
}
