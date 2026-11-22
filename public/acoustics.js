// Babble acoustics — browser-side feature extraction.
// Turns an AudioBuffer into the structured summary the interpreter reads.
//
// Dev B (docs/redesign/dev-b-ribbon.md). Contract note: every field the old
// analyzeBuffer returned is preserved byte-for-byte (server.mjs reads them).
// Added: track { hopMs, f0, rms } with one entry per analysis frame (f0 is 0
// when unvoiced, so the pitch line can be aligned to time), and startMs/endMs
// on each segment.
//
// Two pitch paths. `pinned: true` is the original per-frame autocorrelation,
// kept for the sample clips because their recorded replays quote its numbers.
// Everything else (mic, uploads) uses the noise-tolerant tracker below: steady
// background is subtracted, each frame's candidates are ranked by the energy
// in their first harmonics, and a path search keeps the line from jumping an
// octave. Checked against a spectrogram of an outdoor cat recording with a
// hum at half the cat's pitch.

import { getCtx } from "./audio.js";

export function analyzeBuffer(buf, { pinned = false } = {}) {
  const sr = buf.sampleRate;
  const pcm = buf.getChannelData(0);
  const N = 1024, HOP = 256;
  const frames = [];
  if (pinned) {
    for (let i = 0; i + N <= pcm.length; i += HOP) {
      const w = pcm.subarray(i, i + N);
      frames.push({ rms: rms(w), f0: autocorrF0(w, sr) });
    }
  } else {
    const hp = highpass(pcm, sr, HP_HZ);
    const bins = Math.ceil((TOP_HZ * FFT_N) / sr) + 3;
    const mags = [], cands = [];
    for (let i = 0; i + N <= pcm.length; i += HOP) {
      frames.push({ rms: rms(pcm.subarray(i, i + N)), f0: 0 });
      mags.push(spectrum(longFrame(hp, i + (N >> 1))).subarray(0, bins));
    }
    // steady background (hum, traffic): the mean spectrum of the quietest tenth
    const order = frames.map((f, i) => i).sort((x, y) => frames[x].rms - frames[y].rms);
    const quiet = order.slice(0, Math.max(3, Math.ceil(frames.length / 10)));
    const noise = new Float32Array(bins);
    for (const q of quiet) for (let k = 0; k < bins; k++) noise[k] += mags[q][k] / quiet.length;
    for (let n = 0, i = 0; i + N <= pcm.length; i += HOP, n++) {
      const e = frames[n].rms;
      if (e * e < 1e-4) continue;
      const m = mags[n];
      for (let k = 0; k < bins; k++) m[k] = Math.max(0, m[k] - NOISE_K * noise[k]);
      cands[n] = pitchCandidates(hp.subarray(i, i + N), sr, m);
    }
    trackPitch(frames, cands);
  }

  // --- segment detection: runs of voiced frames split by >250ms silence ---
  const frameMs = (HOP / sr) * 1000;
  const gapFrames = Math.round(250 / frameMs);
  const segs = [];
  let cur = null;
  for (let idx = 0; idx < frames.length; idx++) {
    const f = frames[idx];
    if (f.f0 > 0 && f.rms > 0.01) {
      if (cur) cur.push(f);
      else {
        cur = [f];
        cur.startIdx = idx;
      }
      cur.endIdx = idx;
      cur.gap = 0;
    } else if (cur) {
      if (++cur.gap > gapFrames) {
        segs.push(cur);
        cur = null;
      }
    }
  }
  if (cur) segs.push(cur);
  if (!pinned) for (let i = segs.length - 1; i >= 0; i--) if (segs[i].length * frameMs < MIN_CALL_MS) segs.splice(i, 1);
  const segments = segs.map((s) => {
    const f0s = s.map((f) => f.f0).sort((a, b) => a - b);
    const durMs = Math.round(s.length * frameMs);
    return {
      durMs,
      startMs: Math.round((s.startIdx ?? 0) * frameMs),
      endMs: Math.round(((s.endIdx ?? s.length - 1) + 1) * frameMs),
      f0Median: Math.round(f0s[f0s.length >> 1] || 0),
      f0Min: Math.round(f0s[0] || 0),
      f0Max: Math.round(f0s[f0s.length - 1] || 0),
      shape: classifyShape(smooth(downsample(s.map((f) => f.f0), 16))),
      rmsMax: +Math.max(...s.map((f) => f.rms)).toFixed(3),
    };
  });

  const voiced = frames.filter((f) => f.f0 > 0);
  const f0s = voiced.map((f) => f.f0).sort((a, b) => a - b);
  const med = f0s.length ? f0s[f0s.length >> 1] : 0;
  const near = f0s.filter((f) => f > med * 0.6 && f < med * 1.7);
  const f0Mean = near.length ? Math.round(near.reduce((a, b) => a + b) / near.length) : 0;

  const contour = downsample(
    voiced.map((f) => f.f0),
    24
  ).map((v) => Math.round(v));
  const envelope = downsample(
    frames.map((f) => f.rms),
    24
  ).map((v) => +v.toFixed(3));

  return {
    durationMs: Math.round((pcm.length / sr) * 1000),
    f0Mean,
    f0Median: Math.round(med),
    f0Min: Math.round(f0s[0] || 0),
    f0Max: Math.round(f0s[f0s.length - 1] || 0),
    shape: classifyShape(smooth(downsample(voiced.map((f) => f.f0), 24))),
    voicedRatio: +(voiced.length / Math.max(1, frames.length)).toFixed(2),
    rmsMean: +mean(frames.map((f) => f.rms)).toFixed(3),
    spectralCentroid: Math.round(spectralCentroid(pcm, sr)),
    calls: segments.length,
    segments: segments.slice(0, 8),
    contour,
    envelope,
    track: {
      hopMs: frameMs,
      f0: frames.map((f) => Math.round(f.f0)),
      rms: frames.map((f) => +f.rms.toFixed(4)),
    },
  };
}

function classifyShape(c) {
  if (c.length < 3) return "flat";
  const n = c.length, s = c[0], e = c[n - 1];
  const mid = mean(c.slice(n >> 2, (3 * n) >> 2));
  const lo = Math.min(...c), hi = Math.max(...c), span = hi - lo || 1;
  const trend = (e - s) / n;
  let flips = 0, prev = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1] - trend;
    if (Math.abs(d) < span * 0.12) continue; // ignore jitter
    if (prev && Math.sign(d) !== prev) flips++;
    prev = Math.sign(d);
  }
  if (flips >= 4) return "warble";
  if (mid - s > span * 0.35 && mid - e > span * 0.35) return "arch";
  if ((e - s) / span > 0.4) return "rising";
  if ((s - e) / span > 0.4) return "falling";
  return "flat";
}

function smooth(a) {
  return a.map((_, i) => mean(a.slice(Math.max(0, i - 1), i + 2)));
}

function rms(w) {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * w[i];
  return Math.sqrt(s / w.length);
}

// normalized autocorrelation pitch, 80–1000 Hz
function autocorrF0(w, sr) {
  const minLag = Math.floor(sr / 1000), maxLag = Math.floor(sr / 80);
  let e0 = 0;
  for (let i = 0; i < w.length; i++) e0 += w[i] * w[i];
  if (e0 / w.length < 1e-4) return 0;
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, ea = 0, eb = 0;
    for (let i = 0; i + lag < w.length; i++) {
      s += w[i] * w[i + lag];
      ea += w[i] * w[i];
      eb += w[i + lag] * w[i + lag];
    }
    const r = s / Math.sqrt(ea * eb + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return best > 0.45 ? sr / bestLag : 0;
}

// Real-world captures: tunables for the noise-tolerant pitch tracker.
const HP_HZ = 150, MIN_CALL_MS = 60;

function highpass(pcm, sr, hz) {
  const a = Math.exp((-2 * Math.PI * hz) / sr);
  let src = pcm, out = null;
  for (let pass = 0; pass < 2; pass++) {
    out = new Float32Array(src.length);
    let px = src[0] || 0, py = 0;
    for (let i = 1; i < src.length; i++) {
      py = a * (py + src[i] - px);
      px = src[i];
      out[i] = py;
    }
    src = out;
  }
  return out;
}

const CREL = 0.5;
// every local autocorrelation peak within CREL of the best one, as { f, r }
function pitchCandidates(w, sr, mag) {
  const minLag = Math.floor(sr / 1000), maxLag = Math.floor(sr / 80);
  const rs = new Float32Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0, ea = 0, eb = 0;
    for (let i = 0; i + lag < w.length; i++) {
      s += w[i] * w[i + lag];
      ea += w[i] * w[i];
      eb += w[i + lag] * w[i + lag];
    }
    rs[lag] = s / Math.sqrt(ea * eb + 1e-12);
  }
  const out = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (rs[lag] > rs[lag - 1] && rs[lag] >= rs[lag + 1]) {
      out.push({ f: sr / lag, r: rs[lag] });
      if (rs[lag] > best) best = rs[lag];
    }
  }
  if (best <= 0.45) return null;
  const keep = out.filter((c) => c.r >= best * CREL);
  const binHz = sr / FFT_N;
  const at = (hz) => {
    const b = Math.round(hz / binHz);
    return Math.max(mag[b - 1] || 0, mag[b] || 0, mag[b + 1] || 0);
  };
  // harmonic sum: the first NH harmonics of each candidate, background removed
  const pool = [];
  for (const c of keep) for (const m of [1, 2, 3]) if (c.f * m <= 1000) pool.push(c.f * m);
  let top = 0;
  const scored = pool.map((f) => {
    let sum = 0, odd = 0, even = 0;
    for (let h = 1; h <= 6; h++) {
      const a = at(h * f);
      if (h <= NH) sum += a;
      if (h & 1) odd += a;
      else even += a;
    }
    if (sum > top) top = sum;
    // energy only on the even harmonics means the real pitch is an octave up
    return { f, sum, half: odd < HALF_RATIO * even };
  });
  if (top <= 0) return null;
  // no cost within TIE of the best sum; a slight lean towards the higher pitch
  const fmax = Math.max(...scored.map((c) => c.f));
  return scored.map((c) => ({ f: c.f, cost: CA * Math.max(0, 1 - c.sum / (TIE * top)) + (c.half ? CA : 0) + 0.05 * Math.log2(fmax / c.f) }));
}

const CA = 4, CB = 5;
// cheapest path through each run of voiced frames: the candidate cost per
// frame plus CB per octave moved between neighbouring frames
function trackPitch(frames, cands) {
  let i = 0;
  while (i < frames.length) {
    if (!cands[i]) { i++; continue; }
    let j = i;
    while (j < frames.length && cands[j]) j++;
    let prev = cands[i].map((c) => ({ cost: c.cost, back: -1 }));
    const backs = [prev];
    for (let k = i + 1; k < j; k++) {
      const cur = cands[k].map((c) => {
        let bc = Infinity, bi = 0;
        for (let p = 0; p < prev.length; p++) {
          const t = prev[p].cost + CB * Math.abs(Math.log2(c.f / cands[k - 1][p].f));
          if (t < bc) { bc = t; bi = p; }
        }
        return { cost: bc + c.cost, back: bi };
      });
      backs.push(cur);
      prev = cur;
    }
    let bi = 0;
    for (let p = 1; p < prev.length; p++) if (prev[p].cost < prev[bi].cost) bi = p;
    for (let k = j - 1; k >= i; k--) {
      frames[k].f0 = cands[k][bi].f;
      bi = backs[k - i][bi].back;
    }
    i = j;
  }
}

const NOISE_K = 2;
const FFT_N = 4096, TOP_HZ = 5000, NH = 5, TIE = 0.85, HALF_RATIO = 0.3;
// FFT_N samples centred on `mid`, zero where the clip ends
function longFrame(pcm, mid) {
  const out = new Float32Array(FFT_N), from = mid - (FFT_N >> 1);
  const a = Math.max(0, from), b = Math.min(pcm.length, from + FFT_N);
  if (b > a) out.set(pcm.subarray(a, b), a - from);
  return out;
}
let hann = null;
// magnitude spectrum of one Hann-windowed frame, zero-padded to FFT_N
function spectrum(w) {
  if (!hann || hann.length !== w.length) {
    hann = new Float32Array(w.length);
    for (let i = 0; i < w.length; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (w.length - 1));
  }
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
  for (let i = 0; i < w.length; i++) re[i] = w[i] * hann[i];
  for (let i = 1, j = 0; i < FFT_N; i++) {
    let bit = FFT_N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= FFT_N; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < FFT_N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  const mag = new Float32Array(FFT_N >> 1);
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

function spectralCentroid(pcm, sr) {
  // full DFT magnitudes over a mid-clip window, bins 100-4500 Hz
  const N = 2048, off = Math.max(0, (pcm.length - N) >> 1);
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) {
    const hz = (k * sr) / N;
    if (hz < 100 || hz > 4500) continue;
    let re = 0, im = 0;
    for (let n = 0; n < N; n += 2) {
      const a = (-2 * Math.PI * k * n) / N;
      re += pcm[off + n] * Math.cos(a);
      im += pcm[off + n] * Math.sin(a);
    }
    const m = Math.sqrt(re * re + im * im);
    num += hz * m;
    den += m;
  }
  return den ? num / den : 0;
}

function downsample(arr, n) {
  if (arr.length <= n) return arr.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(mean(arr.slice(Math.floor((i * arr.length) / n), Math.floor(((i + 1) * arr.length) / n))));
  }
  return out;
}
function mean(a) {
  return a.length ? a.reduce((x, y) => x + y) / a.length : 0;
}

// Record `secs` of mic audio on the shared context (audio.js owns the only
// AudioContext). Resolves promptly with a live AnalyserNode so the ribbon can
// paint while recording; `done` resolves to the captured AudioBuffer.
//
// NOTE (Dev B): the capture loop below still uses the deprecated
// ScriptProcessorNode. An AudioWorklet replacement would be nicer (no
// destination hookup needed, no main-thread drops) but is not required for
// correctness, so it stays a possible follow-up, not a blocker.
export async function captureMic(secs = 2.5, onFrame) {
  const ctx = getCtx();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const rec = ctx.createScriptProcessor(2048, 1, 1);
  const chunks = [];
  src.connect(rec);
  // ScriptProcessor only fires while connected to the destination; the shared
  // bus stays at unity gain so this is inaudible beyond the live mic feed
  // already in the room. A worklet would remove this hookup.
  rec.connect(ctx.destination);
  rec.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    onFrame?.(d);
  };
  const startedAt = performance.now();
  const durationMs = secs * 1000;
  const done = new Promise((resolve) => {
    setTimeout(() => {
      rec.disconnect();
      src.disconnect();
      try { analyser.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const pcm = new Float32Array(total);
      let o = 0;
      for (const c of chunks) {
        pcm.set(c, o);
        o += c.length;
      }
      const buf = ctx.createBuffer(1, Math.max(1, total), ctx.sampleRate);
      buf.getChannelData(0).set(pcm);
      resolve(buf);
    }, durationMs);
  });
  return { analyser, startedAt, durationMs, done };
}
