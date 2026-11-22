// Babble audio bus — Dev C (docs/redesign/dev-c-character.md §1).
// Master chain and generated reverb impulse ported from krisyangdev/jelly
// `src/audio.js` (MIT, © Kris Yang): master gain → compressor, convolver send
// with a smoothed decaying-noise impulse. Adapted: two send levels (dry-ish
// clip bus, wetter fx bus) instead of one shared bus.
// One AudioContext for the whole app; nobody else calls `new AudioContext()`.

let ctx = null;
let out = null;     // dry-ish bus: clip playback
let fxOut = null;   // wetter bus: synth voice + UI sounds
let unlocked = false;

export function getCtx() {
  return (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
}

export function unlock() {
  unlocked = true;
  const c = getCtx();
  build();
  if (c.state !== "running") return c.resume();
  return Promise.resolve();
}

function build() {
  if (out) return;
  const c = getCtx();
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 4;
  comp.attack.value = 0.005; comp.release.value = 0.2;
  comp.connect(c.destination);

  // generated reverb impulse: smoothed decaying noise, 0.8s (jelly)
  const len = Math.floor(c.sampleRate * 0.8);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      y += (Math.random() * 2 - 1 - y) * 0.35;
      d[i] = y * Math.pow(1 - i / len, 2.5);
    }
  }
  const conv = c.createConvolver();
  conv.buffer = ir;
  conv.connect(comp);

  out = c.createGain();
  out.gain.value = 0.85;
  out.connect(comp);
  const dryWet = c.createGain(); dryWet.gain.value = 0.08; // the room stays quiet behind the real animal
  out.connect(dryWet); dryWet.connect(conv);

  fxOut = c.createGain();
  fxOut.gain.value = 0.7;
  fxOut.connect(comp);
  const fxWet = c.createGain(); fxWet.gain.value = 0.28;
  fxOut.connect(fxWet); fxWet.connect(conv);
}

export function getOut() {
  if (!out) build();
  return out;
}

export function getFxOut() {
  if (!fxOut) build();
  return fxOut;
}

export async function decode(arrayBuffer) {
  return getCtx().decodeAudioData(arrayBuffer);
}

// source → analyser (fftSize 2048) → dry-ish bus; returns what A forwards on capture:start
export function playBuffer(buf) {
  if (!unlocked) return { analyser: null, startedAt: performance.now(), durationMs: buf.duration * 1000 };
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = buf;
  const analyser = c.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser).connect(getOut());
  src.start();
  return { analyser, startedAt: performance.now(), durationMs: buf.duration * 1000 };
}

// Long uploads: keep only the loudest `secs` so the model hears the part
// where the animal is actually speaking. Mono mix, 1 s hop windows.
export function loudestWindow(buf, secs = 12) {
  const total = buf.duration;
  if (total <= secs) return { buffer: buf, fromSec: 0, toSec: total, totalSec: total };
  const sr = buf.sampleRate;
  const nCh = buf.numberOfChannels;
  const mono = new Float32Array(buf.length);
  for (let ch = 0; ch < nCh; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < buf.length; i++) mono[i] += d[i] / nCh;
  }
  const winS = Math.floor(secs * sr), hopS = Math.floor(1 * sr);
  let best = 0, bestFrom = 0;
  for (let from = 0; from + winS <= buf.length; from += hopS) {
    let e = 0;
    for (let i = from; i < from + winS; i += 64) e += mono[i] * mono[i]; // stride sampling: plenty for ranking
    if (e > best) { best = e; bestFrom = from; }
  }
  const out = getCtx().createBuffer(nCh, winS, sr);
  for (let ch = 0; ch < nCh; ch++)
    out.getChannelData(ch).set(buf.getChannelData(ch).subarray(bestFrom, bestFrom + winS));
  return { buffer: out, fromSec: bestFrom / sr, toSec: (bestFrom + winS) / sr, totalSec: total };
}
