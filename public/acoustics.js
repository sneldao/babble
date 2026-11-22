// Babble acoustics — browser-side feature extraction.
// Turns an AudioBuffer into the structured summary the interpreter reads.
//
// Dev B (docs/redesign/dev-b-ribbon.md). Contract note: every field the old
// analyzeBuffer returned is preserved byte-for-byte (server.mjs reads them).
// Added: track { hopMs, f0, rms } with one entry per analysis frame (f0 is 0
// when unvoiced, so the pitch line can be aligned to time), and startMs/endMs
// on each segment.

import { getCtx } from "./audio.js";

export function analyzeBuffer(buf) {
  const sr = buf.sampleRate;
  const pcm = buf.getChannelData(0);
  const N = 1024, HOP = 256;
  const frames = [];
  for (let i = 0; i + N <= pcm.length; i += HOP) {
    const w = pcm.subarray(i, i + N);
    frames.push({ rms: rms(w), f0: autocorrF0(w, sr) });
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
