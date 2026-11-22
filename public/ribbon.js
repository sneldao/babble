// Sound ribbon — Dev B (docs/redesign/dev-b-ribbon.md).
//
// One canvas across #ribbon: the real DSP, large and annotated. Every mark
// comes from a measured value (the vinyl principle: the picture is drawn from
// the audio data itself, lit by how strongly it is modulated). The dot-matrix
// telemetry display and the staged boot are reimplementations of the
// beat-machine idea in Canvas2D; corner brackets / mono readouts echo the
// procedural-eye HUD language. No code is taken from those repos.

import { SPECIES } from "./stage.js";

const FMIN = 80, FMAX = 4000;
const F_TICKS = [100, 200, 500, 1000, 2000, 4000];
const TIME_STEP_MS = 500;
const SPEC_ROWS = 128;
const LIVE_COLS = 256, LIVE_ROWS = 64;
const FFT_N = 512;

const PAD = { l: 44, r: 10, t: 18, b: 58 };
const MONO = `"Kode Mono", ui-monospace, monospace`;

// --- radix-2 FFT (settled spectrogram) -------------------------------------

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}
const HANN = hann(FFT_N);

function fftMag(pcm, off, sr) {
  // Magnitudes of the FFT_N window at `off`, bins 0..FFT_N/2.
  const n = FFT_N;
  const re = new Float64Array(n), im = new Float64Array(n);
  const len = Math.min(n, pcm.length - off);
  for (let i = 0; i < len; i++) re[i] = pcm[off + i] * HANN[i];
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = re[i]; re[i] = re[j]; re[j] = t;
      const u = im[i]; im[i] = im[j]; im[j] = u;
    }
  }
  for (let len2 = 2; len2 <= n; len2 <<= 1) {
    const ang = (-2 * Math.PI) / len2;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len2) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len2 / 2; k++) {
        const a = i + k, b = i + k + len2 / 2;
        const vr = re[b] * cwr - im[b] * cwi;
        const vi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
  const out = new Float32Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return out;
}

// --- helpers ---------------------------------------------------------------

function fmtHz(hz) {
  return hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 2000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

function shapeCurve(shape, t) {
  switch (shape) {
    case "rising": return 0.85 + 0.3 * t;
    case "falling": return 1.15 - 0.3 * t;
    case "arch": return 1 + 0.25 * Math.sin(Math.PI * t);
    case "warble": return 1 + 0.15 * Math.sin(4 * Math.PI * t);
    default: return 1;
  }
}

// Parse an evidence citation into the marks the pitch axis should show:
// a single line for a lone f0 value, a band for a cited range, and the
// call count for bracket emphasis. "centroid"/"spectral" values are not
// on the pitch line; ms/s numbers are ignored.
export function parseEvidence(str) {
  const out = { line: null, band: null, calls: null };
  if (!str) return out;
  const clamp = (v) => Math.min(FMAX, Math.max(FMIN, v));
  const ctx = (i) => str.slice(Math.max(0, i - 30), i);
  const offPitch = (i) => /centroid|spectral/i.test(ctx(i));
  const rge = /(\d{2,4})\s*[–-]\s*(\d{2,4})\s*Hz/gi;
  let m;
  while ((m = rge.exec(str))) {
    if (!offPitch(m.index)) { out.band = [clamp(+m[1]), clamp(+m[2])]; break; }
  }
  const one = /(\d{2,4})\s*Hz/gi;
  while ((m = one.exec(str))) {
    const start = m.index, end = m.index + m[1].length;
    if (offPitch(start)) continue;                       // not on the pitch line
    if (/[–-]\s*$/.test(str.slice(0, start))) continue;  // range end
    if (/^\s*[–-]\s*\d{2,4}\s*Hz/i.test(str.slice(end))) continue; // range start
    out.line = clamp(+m[1]);
    break;
  }
  const c = str.match(/(?<![\d.])(\d+)(?:\s+\w+){0,2}?\s+calls?/i);
  if (c) out.calls = +c[1];
  else if (/\b(?:single|one|a)\b[^;]{0,30}?\bcalls?\b/i.test(str)) out.calls = 1;
  return out;
}

export function mount(el, stage) {
  const canvas = document.createElement("canvas");
  canvas.className = "ribbon-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Sound ribbon: spectrogram of the captured sound");
  el.appendChild(canvas);
  const status = document.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("aria-live", "polite");
  el.appendChild(status);

  const ctx = canvas.getContext("2d");
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Session state. Times in ms; capture-relative unless noted.
  const S = {
    species: stage.species,
    capture: null,      // { source, startedAt, durationMs, analyser }
    features: null,
    buffer: null,
    marks: [],          // { ms, kind: "first"|"last", lane, replay }
    talk: null,         // { originMs, entries, endMs }
    failed: false,
    failReason: "",
    raceOn: false,
    evidence: null,     // cerebras header citation string, or null
    live: null,         // { analyser, startedAt, durationMs, fq, raf, lastP }
    liveImg: null,      // offscreen canvas LIVE_COLS x LIVE_ROWS
    specImg: null,      // offscreen canvas nCols x SPEC_ROWS
    specDurMs: 0,
    computing: 0,       // settled-compute token
    gen: 0,             // capture generation — stale async work checks it
    settling: false,
    playP: -1,
    colors: null,
  };

  function readColors() {
    const cs = getComputedStyle(el);
    S.colors = {
      paper: cs.getPropertyValue("--paper").trim() || "#f3ecdf",
      ink: cs.getPropertyValue("--ink").trim() || "#1c1a17",
      ink2: cs.getPropertyValue("--ink-2").trim() || "#6b645a",
      signal: cs.getPropertyValue("--signal").trim() || "#e4572e",
      rival: cs.getPropertyValue("--rival").trim() || "#4a4e9e",
      ok: cs.getPropertyValue("--ok").trim() || "#2f7d5b",
      warn: cs.getPropertyValue("--warn").trim() || "#b3261e",
      rule: "rgba(28,26,23,0.16)",
    };
  }
  readColors();

  function size() {
    const w = Math.max(50, el.clientWidth);
    const h = Math.max(50, el.clientHeight || canvas.clientHeight || 280);
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  const W = () => canvas.width / Math.min(2, devicePixelRatio || 1);
  const H = () => canvas.height / Math.min(2, devicePixelRatio || 1);
  const plotW = () => W() - PAD.l - PAD.r;
  const plotH = () => H() - PAD.t - PAD.b;

  function axisMs() {
    let m = S.capture?.durationMs || 0;
    if (S.talk) m = Math.max(m, S.talk.endMs + 400);
    for (const k of S.marks) m = Math.max(m, k.ms);
    if (!S.capture && !S.talk) return 3000; // idle grid
    return Math.max(m, S.capture?.durationMs || 0, 800);
  }

  const xFor = (ms) => PAD.l + (plotW() * ms) / axisMs();
  const yFor = (hz) => {
    const c = Math.min(FMAX, Math.max(FMIN, hz));
    return PAD.t + plotH() * (1 - Math.log(c / FMIN) / Math.log(FMAX / FMIN));
  };
  const hzForRow = (j, rows) => {
    // j = 0 is the top row (FMAX)
    const t0 = j / rows, t1 = (j + 1) / rows;
    return [FMIN * Math.pow(FMAX / FMIN, 1 - t1), FMIN * Math.pow(FMAX / FMIN, 1 - t0)];
  };

  function say(msg) { status.textContent = msg; }

  // --- live phase ----------------------------------------------------------

  function stopLive() {
    if (S.live) cancelAnimationFrame(S.live.raf);
    S.live = null;
  }

  function paintLiveColumn() {
    const L = S.live;
    L.analyser.getByteFrequencyData(L.fq);
    const sr = L.analyser.context.sampleRate;
    const binHz = sr / L.analyser.fftSize;
    const img = S.liveImg.getContext("2d");
    const col = Math.min(LIVE_COLS - 1, Math.floor(progress() * (LIVE_COLS - 1)));
    for (let j = 0; j < LIVE_ROWS; j++) {
      const [lo, hi] = hzForRow(j, LIVE_ROWS);
      const b0 = Math.max(0, Math.floor(lo / binHz)), b1 = Math.max(b0, Math.ceil(hi / binHz));
      let sum = 0;
      for (let b = b0; b < Math.min(b1, L.fq.length); b++) sum += L.fq[b];
      const v = Math.sqrt(sum / Math.max(1, Math.min(b1, L.fq.length) - b0) / 255);
      img.fillStyle = cellColor(v);
      img.fillRect(col, j, 1, 1);
    }
  }

  function hexRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return [28, 26, 23];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function cellColor(v) {
    if (v < 0.04) return S.colors.paper;
    const a = Math.min(1, 0.15 + v * 0.85).toFixed(2);
    if (v > 0.72) {
      const [r, g, b] = hexRgb(S.colors.signal);
      return `rgba(${r},${g},${b},${a})`;
    }
    return `rgba(28,26,23,${a})`;
  }

  function progress() {
    const L = S.live;
    if (!L) return 1;
    return Math.min(1, Math.max(0, (performance.now() - L.startedAt) / L.durationMs));
  }

  function liveTick(gen) {
    if (!S.live || gen !== S.gen) return;
    paintLiveColumn();
    S.playP = progress();
    draw();
    if (S.playP < 1) S.live.raf = requestAnimationFrame(() => liveTick(gen));
    else S.playP = -1; // hold the painted history until analysis settles
  }

  // --- settled compute (chunked FFT, never blocks input) -------------------

  function computeSettled() {
    const token = ++S.computing;
    const buf = S.buffer;
    if (!buf) return;
    const pcm = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const durMs = S.features?.durationMs || S.capture?.durationMs || 0;
    const nCols = Math.min(320, Math.max(96, Math.round(durMs / 12)));
    const cols = new Array(nCols);
    const step = (pcm.length - FFT_N) / Math.max(1, nCols - 1);
    let max = 0;
    let i = 0;
    // Paint progressively left-to-right so the picture visibly fills in.
    const img = document.createElement("canvas");
    img.width = nCols; img.height = SPEC_ROWS;
    const g = img.getContext("2d");
    g.fillStyle = S.colors.paper;
    g.fillRect(0, 0, nCols, SPEC_ROWS);
    const binHz = sr / FFT_N;
    S.specImg = img;
    S.specDurMs = durMs;
    S.settling = true;
    function chunk() {
      if (token !== S.computing) { S.settling = false; return; }
      const end = Math.min(nCols, i + 96);
      for (; i < end; i++) {
        const mags = fftMag(pcm, Math.max(0, Math.floor(i * step)), sr);
        cols[i] = mags;
        for (let k = 0; k < mags.length; k++) if (mags[k] > max) max = mags[k];
      }
      // paint the newly computed columns with the running max
      for (let c = Math.max(0, i - 96); c < i; c++) {
        const mags = cols[c];
        for (let j = 0; j < SPEC_ROWS; j++) {
          const [lo, hi] = hzForRow(j, SPEC_ROWS);
          const b0 = Math.max(1, Math.floor(lo / binHz));
          const b1 = Math.max(b0 + 1, Math.ceil(hi / binHz));
          let sum = 0;
          for (let b = b0; b < Math.min(b1, mags.length); b++) sum += mags[b];
          const v = Math.sqrt(sum / (Math.min(b1, mags.length) - b0) / (max || 1));
          g.fillStyle = cellColor(v);
          g.fillRect(c, j, 1, 1);
        }
      }
      draw();
      if (i < nCols) { requestAnimationFrame(chunk); return; }
      if (token !== S.computing) { S.settling = false; return; }
      S.settling = false;
      draw();
      say("Spectrogram settled.");
    }
    requestAnimationFrame(chunk);
  }

  // --- drawing -------------------------------------------------------------

  function draw() {
    readColorsIfNeeded();
    // devicePixelRatio can change without a ResizeObserver (emulation,
    // moving between displays); a stale backing store paints at the wrong
    // scale, so re-fit first — size() calls back into draw().
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.max(50, el.clientWidth);
    const ch = Math.max(50, el.clientHeight || canvas.clientHeight || 280);
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      size();
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    const w = W(), h = H();
    const C = S.colors;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, w, h);

    const ax = axisMs();
    const pw = plotW(), ph = plotH();

    // Broken-axis layout: the capture always owns ≥72% of the plot; late
    // arrivals live in a fixed-width hatched zone, not on the time axis.
    const durMsZ = S.capture?.durationMs || 0;
    const zoneOn = !!(S.capture && !S.talk && ax > durMsZ + 1);
    const zoneW = zoneOn ? Math.min(Math.max(120, pw * 0.28), pw * 0.35) : 0;
    const capW = pw - zoneW;
    const zoneX = PAD.l + capW;              // zone's left edge (incl. 14px break)
    const zoneMarksX = zoneX + 14;           // marks space inside the zone
    const xForZ = (ms) => ms <= durMsZ
      ? PAD.l + (capW * ms) / Math.max(1, durMsZ)
      : zoneMarksX + ((ms - durMsZ) / Math.max(1, ax - durMsZ)) * (PAD.l + pw - 6 - zoneMarksX);
    const xLin = zoneOn ? xForZ : (ms) => PAD.l + (pw * ms) / ax;

    // Species range band (behind the signal so calls land visibly inside it).
    const sp = SPECIES[S.species] || SPECIES.cat;
    if (sp?.rangeHz) {
      ctx.fillStyle = "rgba(28,26,23,0.05)";
      const y0 = yFor(sp.rangeHz[1]), y1 = yFor(sp.rangeHz[0]);
      ctx.fillRect(PAD.l, y0, pw, y1 - y0);
      ctx.strokeStyle = C.rule;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y0); ctx.lineTo(PAD.l + pw, y0);
      ctx.moveTo(PAD.l, y1); ctx.lineTo(PAD.l + pw, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Spectrogram: settled image, else live history.
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    if (S.talk) ctx.globalAlpha = 0.25; // reply view: capture recedes
    if (S.specImg) {
      const sw = zoneOn ? (capW * S.specDurMs) / Math.max(1, durMsZ) : (pw * S.specDurMs) / ax;
      ctx.drawImage(S.specImg, PAD.l, PAD.t, Math.max(1, sw), ph);
    } else if (S.liveImg && S.capture) {
      const sw = zoneOn ? capW : (pw * S.capture.durationMs) / ax;
      ctx.drawImage(S.liveImg, PAD.l, PAD.t, Math.max(1, sw), ph);
    }
    ctx.restore();

    // After-the-sound zone: a fixed-width hatched strip past a broken axis,
    // so a late answer never shrinks the sound itself.
    if (zoneOn) {
      const x0 = zoneX, x1 = PAD.l + pw;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0 + 14, PAD.t, x1 - x0 - 14, ph); ctx.clip();
      ctx.fillStyle = "rgba(28,26,23,0.06)";
      ctx.fillRect(x0, PAD.t, x1 - x0, ph);
      ctx.strokeStyle = C.rule;
      ctx.lineWidth = 1;
      for (let x = x0 - ph + 14; x < x1; x += 7) {
        ctx.beginPath();
        ctx.moveTo(x, PAD.t + ph); ctx.lineTo(x + ph, PAD.t);
        ctx.stroke();
      }
      ctx.restore();
      // Axis break: "//" through the plot at the capture boundary.
      ctx.strokeStyle = C.ink2;
      ctx.lineWidth = 1;
      for (const dx of [4, 10]) {
        ctx.beginPath();
        ctx.moveTo(x0 + dx - 2, PAD.t + ph + 12);
        ctx.lineTo(x0 + dx + 4, PAD.t);
        ctx.stroke();
      }
      ctx.fillStyle = C.ink2;
      ctx.font = `10px ${MONO}`;
      ctx.fillText("after the sound", x0 + 16, PAD.t + 12);
    }

    // Loudness envelope strip along the bottom edge.
    const track = S.features?.track;
    if (track?.rms?.length) {
      const maxR = Math.max(0.001, ...track.rms);
      ctx.fillStyle = "rgba(28,26,23,0.30)";
      const bw = (zoneOn ? capW : pw) / track.rms.length;
      for (let i = 0; i < track.rms.length; i++) {
        const bh = Math.max(1, (track.rms[i] / maxR) * 13);
        const x = xLin(i * track.hopMs);
        ctx.fillRect(x, PAD.t + ph - bh, Math.max(1, bw), bh);
      }
    }

    // Pitch line on the same Hz axis. Breaks on unvoiced frames, on jumps
    // over 35% between consecutive voiced frames (octave errors), and drops
    // voiced runs shorter than 3 frames — never a segment to the floor.
    if (track?.f0?.length) {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      let run = [];
      let voicedAt = 0, voicedN = 0;
      const flush = () => {
        if (run.length >= 3) {
          ctx.beginPath();
          run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }
        run = [];
      };
      let prev = 0;
      for (let i = 0; i < track.f0.length; i++) {
        const f0 = track.f0[i];
        if (!f0 || (prev && (f0 > prev * 1.35 || f0 < prev / 1.35))) { flush(); prev = f0; continue; }
        prev = f0;
        const x = xLin(i * track.hopMs);
        run.push([x, yFor(f0)]);
        voicedAt += i * track.hopMs; voicedN++;
      }
      flush();
      const med = S.features?.f0Median;
      if (med && voicedN) {
        ctx.fillStyle = C.signal;
        ctx.beginPath();
        ctx.arc(xLin(voicedAt / voicedN), yFor(med), 3.5, 0, 7);
        ctx.fill();
      }
    }

    // HUD right readout, computed early so label placement can dodge it.
    const rightWord = S.failed ? (S.failReason === "demo" ? "measured · hosted demo" : "decode failed · capture kept") : stateWord();
    const right = rightWord + (S.raceOn ? " · race" : "");
    ctx.font = `10px ${MONO}`;
    const rtw = ctx.measureText(right).width;
    const rightX = w - 12 - rtw;

    // Evidence citations from the cerebras header: a cited frequency lands as
    // a marker on the pitch axis, a cited call count emphasises brackets.
    const ev = parseEvidence(S.evidence || "");
    const evCalls = ev.calls != null ? String(ev.calls) : null;

    // Segment call brackets. Labels stagger across rows so adjacent calls
    // stay legible; on narrow plots they fall back to a compact form.
    const segs = S.features?.segments || [];
    ctx.font = `10px ${MONO}`;
    const full = (sg, i) => `${i + 1} · ${sg.durMs}ms · ${sg.shape} · ${sg.f0Median}Hz`;
    const compact = (sg, i) => `${i + 1} · ${sg.shape}`;
    const pack = (textOf) => {
      const rows = [];
      let worst = 0;
      const items = segs.slice(0, 8).map((sg, i) => {
        const label = textOf(sg, i);
        const tw = ctx.measureText(label).width;
        const x0 = xLin(sg.startMs ?? 0), x1 = xLin(sg.endMs ?? sg.durMs ?? 0);
        const lx = Math.min(Math.max(PAD.l, (x0 + x1 - tw) / 2), PAD.l + (zoneOn ? capW : pw) - tw);
        let row = 0;
        while (rows.some((p) => p.row === row && lx < p.x1 + 6 && lx + tw + 6 > p.x)) row++;
        rows.push({ row, x: lx, x1: lx + tw });
        if (row > worst) worst = row;
        return { sg, i, label, lx, row };
      });
      return { items, worst };
    };
    let { items, worst } = pack(full);
    if (worst > 2) ({ items } = pack(compact)); // narrow plot: short labels
    const emphasise = evCalls != null && +evCalls === segs.length && +evCalls > 0 ? +evCalls : 0;
    for (const { sg, i, label, lx, row } of items) {
      const x0 = xLin(sg.startMs ?? 0), x1 = xLin(sg.endMs ?? sg.durMs ?? 0);
      const y = PAD.t + ph + 22;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.moveTo(x0, y); ctx.lineTo(x0, y + 4);
      ctx.moveTo(x1, y); ctx.lineTo(x1, y + 4);
      ctx.stroke();
      ctx.fillStyle = i < emphasise ? C.signal : C.ink;
      ctx.fillText(label, lx, y + 11 + Math.min(row, 1) * 11);
    }

    // Cited frequencies: a faint full-width tick per value, a translucent
    // band for a cited f0 range, each with a mono label at the right edge.
    ctx.font = `10px ${MONO}`;
    if (ev.band) {
      const [a, b] = ev.band;
      const y0 = yFor(b), y1 = yFor(a);
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = C.signal;
      ctx.fillRect(PAD.l, y0, pw, y1 - y0);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(PAD.l, y0, pw, 1);
      ctx.fillRect(PAD.l, y1 - 1, pw, 1);
      ctx.restore();
      const lbl = `${a}–${b} Hz`;
      const lw = ctx.measureText(lbl).width;
      ctx.fillStyle = C.signal;
      ctx.fillText(lbl, PAD.l + pw - lw - 4, y1 + 10);
    }
    if (ev.line != null) {
      const y = yFor(ev.line);
      if (y > PAD.t + 6 && y < PAD.t + ph - 4) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = C.signal;
        ctx.fillRect(PAD.l, y - 1, pw, 2);
        ctx.restore();
        const lbl = `${ev.line} Hz`;
        const lw = ctx.measureText(lbl).width;
        ctx.fillStyle = C.signal;
        ctx.fillText(lbl, PAD.l + pw - lw - 4, y - 5);
      }
    }

    // Arrival marks: proof of the speed claim. Marks < 90 css px apart get
    // one combined "words a–b s" label over a bracket; the second close
    // label otherwise drops to a lower row.
    // Seed the collision set with the HUD right readout and the "after the
    // sound" zone label so far-right mark labels (e.g. a long "… · replay"
    // one) drop below them instead of overprinting.
    const markPlaced = [{ x: rightX - 6, x1: w - 6 }];
    if (zoneOn) markPlaced.push({ x: zoneX + 10, x1: zoneX + 112 });
    const markGroups = [];
    for (const m of [...S.marks].sort((a, b) => a.ms - b.ms)) {
      const x = xLin(m.ms);
      const last = markGroups[markGroups.length - 1];
      if (last && m.lane === last[0].lane && Math.abs(x - xLin(last[last.length - 1].ms)) < 90) last.push(m);
      else markGroups.push([m]);
    }
    // Dots first, labels second: a later group's dot must not land inside an
    // earlier label's tail, so every dot joins the collision set.
    const dots = markGroups.map((grp) => grp.map((m) => xLin(m.ms)));
    markGroups.forEach((grp, gi) => {
      const col = grp[0].lane === "rival" ? C.rival : C.ink;
      const replay = grp[0].replay;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      for (const x of dots[gi]) {
        if (replay) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, PAD.t + 14); ctx.lineTo(x, PAD.t + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, PAD.t + 4, 3.5, 0, 7);
        if (replay) { ctx.strokeStyle = col; ctx.stroke(); }
        else { ctx.fillStyle = col; ctx.fill(); }
      }
      if (grp.length > 1) {
        const x0 = dots[gi][0], x1 = dots[gi][dots[gi].length - 1];
        ctx.beginPath();
        ctx.moveTo(x0, PAD.t + 18); ctx.lineTo(x1, PAD.t + 18);
        ctx.strokeStyle = col;
        ctx.stroke();
      }
    });
    markGroups.forEach((grp, gi) => {
      const col = grp[0].lane === "rival" ? C.rival : C.ink;
      const replay = grp[0].replay;
      ctx.fillStyle = col;
      ctx.font = `10px ${MONO}`;
      let label, lx, tw;
      if (grp.length > 1) {
        const t0 = (grp[0].ms / 1000).toFixed(2), t1 = (grp[grp.length - 1].ms / 1000).toFixed(2);
        label = `words ${t0}–${t1} s` + (replay ? " · replay" : "");
        tw = ctx.measureText(label).width;
        const x0 = dots[gi][0], x1 = dots[gi][dots[gi].length - 1];
        lx = Math.min(Math.max(PAD.l + 2, (x0 + x1) / 2 - tw / 2), PAD.l + pw - tw);
      } else {
        const m = grp[0];
        label = `${m.kind === "first" ? "first word" : "last word"}` +
          (m.lane === "rival" ? " · gpu" : "") + (m.replay ? " · replay" : "");
        tw = ctx.measureText(label).width;
        lx = Math.min(Math.max(PAD.l + 2, dots[gi][0] + 6), PAD.l + pw - tw);
      }
      let drop = 0;
      const otherDots = dots.flatMap((xs, j) => j === gi ? [] : xs.map((x) => ({ x: x - 4, x1: x + 4 })));
      if (markPlaced.concat(otherDots).some((p) => lx < p.x1 + 4 && lx + tw + 4 > p.x)) drop = 12;
      // Marks near the left edge: sit below the title line and to the right
      // of the mark, clear of the y-axis frequency labels.
      const leftEdge = lx < PAD.l + 56;
      const ly = PAD.t + (leftEdge ? 22 : 9) + drop;
      markPlaced.push({ x: lx, x1: lx + tw });
      ctx.fillText(label, lx, ly);
    });

    // The frame sent with the sound: a quiet ink-2 tick on the time axis,
    // nudged a row if it would sit on an arrival label.
    if (S.frameMs != null && !S.talk) {
      const fx = xLin(S.frameMs);
      ctx.strokeStyle = C.ink2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx, PAD.t + ph - 10); ctx.lineTo(fx, PAD.t + ph);
      ctx.stroke();
      ctx.fillStyle = C.ink2;
      ctx.font = `10px ${MONO}`;
      const ftw = ctx.measureText("frame").width;
      let flx = Math.min(Math.max(PAD.l + 2, fx + 4), PAD.l + pw - ftw);
      let fly = PAD.t + ph - 14;
      if (markPlaced.some((p) => Math.abs(flx - p.x) < 40 || (flx < p.x1 + 4 && flx + ftw + 4 > p.x))) fly += 12;
      ctx.fillText("frame", flx, fly);
    }

    // Talk-back view: reply syllables own the plot on their own time axis.
    if (S.talk) {
      const total = S.talk.totalMs || 1;
      const xT = (ms) => PAD.l + (pw * ms) / total;
      ctx.lineWidth = 2;
      for (const s of S.talk.entries) {
        const x0 = xT(s.tMs);
        const x1 = xT(s.tMs + s.durMs);
        ctx.strokeStyle = C.signal;
        ctx.beginPath();
        let mx = x0, my = 0;
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          const x = x0 + (x1 - x0) * t;
          const y = yFor(s.pitch * shapeCurve(s.shape, t));
          if (t === 0.5) { mx = x; my = y; }
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
        if (s.gloss) {
          const g = String(s.gloss).slice(0, 18);
          ctx.fillStyle = C.ink2;
          ctx.font = `10px ${MONO}`;
          ctx.fillText(g, mx - ctx.measureText(g).width / 2, my - 6);
        }
      }
      ctx.fillStyle = C.ink2;
      ctx.font = `10px ${MONO}`;
      const spName = SPECIES[S.species]?.label?.toLowerCase() || S.species;
      const cap = `your reply, in ${spName}`;
      ctx.fillText(cap, PAD.l + pw - ctx.measureText(cap).width, PAD.t + 22);
    }

    // Grid + ticks.
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = C.ink2;
    ctx.strokeStyle = C.rule;
    ctx.lineWidth = 1;
    for (const hz of F_TICKS) {
      const y = yFor(hz);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.fillText(fmtHz(hz), 8, y + 3);
    }
    const timeAx = zoneOn ? durMsZ : ax;
    const step = timeAx > 9000 ? 2000 : timeAx > 4500 ? 1000 : TIME_STEP_MS;
    const steps = Math.floor(timeAx / step);
    for (let i = 0; i <= steps; i++) {
      const t = i * step;
      const x = xLin(t);
      ctx.beginPath(); ctx.moveTo(x, PAD.t + 14); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
      ctx.fillText(`${(t / 1000).toFixed(1)}s`, x - 8, PAD.t + ph + 10);
    }

    // Live playhead (suppressed under reduced motion).
    if (!RM && S.playP >= 0 && S.capture) {
      const x = zoneOn ? PAD.l + capW * S.playP : PAD.l + (pw * S.capture.durationMs * S.playP) / ax;
      ctx.strokeStyle = C.signal;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.t + 14); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
    }

    // HUD frame: corner brackets + mono readouts (procedural-eye language).
    const sp2 = SPECIES[S.species] || SPECIES.cat;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    const bl = 9;
    for (const [cx, cy, dx, dy] of [[0.5, 0.5, 1, 1], [w - 0.5, 0.5, -1, 1], [0.5, h - 0.5, 1, -1], [w - 0.5, h - 0.5, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * bl, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * bl);
      ctx.stroke();
    }
    ctx.fillStyle = C.ink2;
    ctx.font = `10px ${MONO}`;
    let title = S.evidence
      ? `heard: ${S.evidence}`
      : `RIBBON · ${sp2.label || S.species} ${sp2.rangeHz ? `${sp2.rangeHz[0]}–${sp2.rangeHz[1]} Hz` : ""} · 80–4k log`;
    const titleMax = rightX - 8 - 12;
    while (title.length > 8 && ctx.measureText(title).width > titleMax) {
      title = title.slice(0, title.lastIndexOf(" ", Math.max(8, title.length - 8))) || title.slice(0, -4);
      if (!title.endsWith("…")) title += "…";
    }
    ctx.fillText(title, 12, 12);
    ctx.fillStyle = S.failed && S.failReason !== "demo" ? C.warn : C.ink2;
    ctx.fillText(right, rightX, 15);

    // Idle / empty states are never a blank box.
    if (!S.capture && !S.talk) {
      ctx.fillStyle = C.ink2;
      ctx.font = `12px ${MONO}`;
      const msg = S.failed ? "capture failed — press retry" : "waiting for a sound";
      const mw = ctx.measureText(msg).width;
      ctx.fillText(msg, PAD.l + (pw - mw) / 2, PAD.t + ph / 2);
    }
  }

  let lastSpecies = S.species;
  function readColorsIfNeeded() {
    if (lastSpecies !== S.species) { lastSpecies = S.species; readColors(); }
  }

  function stateWord() {
    if (!S.capture) return "idle";
    if (S.settling) return "settling";
    if (S.specImg) return "settled";
    if (S.live) return "live";
    return "waiting";
  }

  function resetSession(source, startedAt, durationMs, analyser) {
    stopLive();
    S.gen++;
    S.computing++; // cancel any settled compute in flight
    S.settling = false;
    S.capture = { source, startedAt, durationMs, analyser };
    S.features = null;
    S.buffer = null;
    S.marks = [];
    S.talk = null;
    S.failed = false;
    S.raceOn = false;
    S.evidence = null;
    S.specImg = null;
    S.frameMs = null;
    S.playP = -1;
    S.liveImg = document.createElement("canvas");
    S.liveImg.width = LIVE_COLS; S.liveImg.height = LIVE_ROWS;
    const g = S.liveImg.getContext("2d");
    g.fillStyle = S.colors.paper;
    g.fillRect(0, 0, LIVE_COLS, LIVE_ROWS);
  }

  // --- stage subscriptions -------------------------------------------------

  stage.on("species", (d) => { S.species = d.species; draw(); });

  stage.on("capture:start", (d) => {
    resetSession(d.source, d.startedAt, d.durationMs, d.analyser || null);
    say(`Capturing ${d.source}.`);
    const gen = S.gen;
    if (d.analyser && !RM) {
      S.live = {
        analyser: d.analyser,
        startedAt: d.startedAt,
        durationMs: d.durationMs,
        fq: new Uint8Array(d.analyser.frequencyBinCount),
        raf: 0,
      };
      liveTick(gen);
    } else if (d.analyser) {
      // Reduced motion: still sample the live data, without the sweep.
      S.live = {
        analyser: d.analyser,
        startedAt: d.startedAt,
        durationMs: d.durationMs,
        fq: new Uint8Array(d.analyser.frequencyBinCount),
        raf: 0,
      };
      const sample = () => {
        if (!S.live || gen !== S.gen) return;
        paintLiveColumn();
        S.playP = -1;
        draw();
        if (progress() < 1) S.live.raf = requestAnimationFrame(sample);
      };
      sample();
    } else {
      say("Reading sound file.");
    }
    draw();
  });

  stage.on("analysis", (d) => {
    stopLive();
    S.playP = -1;
    S.features = d.features;
    S.buffer = d.buffer || null;
    say(`Analysis: ${d.features?.calls ?? 0} calls.`);
    if (S.buffer) computeSettled();
    else draw();
  });

  stage.on("interpret:start", (d) => {
    if (d.lane === "cerebras") {
      S.raceOn = false;
      // A live retry reuses the capture: drop stale marks, keep the picture.
      if (!S.capture) { S.marks = []; S.failed = false; }
    } else if (d.lane === "rival") {
      S.raceOn = true;
    }
    draw();
  });

  stage.on("interpret:delta", (d) => {
    if (!S.capture) return;
    S.failed = false; // streaming (live or replay) supersedes the error
    if (d.first) {
      const ms = Math.max(0, (d.t ?? performance.now()) - S.capture.startedAt);
      if (!S.marks.some((m) => m.kind === "first" && m.lane === d.lane)) {
        S.marks.push({ ms, kind: "first", lane: d.lane, replay: false });
      }
    }
    draw();
  });

  function markLastWord(lane, replay) {
    if (!S.capture) return;
    S.failed = false; // a finished decode supersedes the earlier error
    S.marks = S.marks.filter((m) => !(m.kind === "last" && m.lane === lane));
    S.marks.push({
      ms: Math.max(0, performance.now() - S.capture.startedAt),
      kind: "last", lane, replay: !!replay,
    });
    for (const m of S.marks) if (m.lane === lane) m.replay = !!replay;
    draw();
    const cereb = S.marks.filter((m) => m.lane === "cerebras").map((m) => m.kind).join(",");
    say(replay ? "Replay finished." : `Finished: ${cereb}.`);
  }

  stage.on("interpret:done", (d) => markLastWord(d.lane, d.replay));

  stage.on("interpret:header", (d) => {
    if (d.lane !== "cerebras") return;
    S.evidence = typeof d.evidence === "string" && d.evidence.trim() ? d.evidence.trim() : null;
    draw();
  });

  stage.on("interpret:error", (d) => {
    if (d.lane !== "cerebras") return;
    S.failed = true;
    S.failReason = d.reason || "error";
    say("Interpretation failed. Capture kept.");
    draw();
  });

  stage.on("media:frame", (d) => {
    S.frameMs = typeof d.tMs === "number" ? d.tMs : null;
    draw();
  });
  stage.on("media:clear", () => { S.frameMs = null; draw(); });

  stage.on("vocalize:play", (d) => {
    const entries = (d.schedule || []).map((s) => ({
      tMs: s.tMs, durMs: s.durMs, shape: s.shape, pitch: s.pitch, gloss: s.gloss,
    }));
    const endMs = entries.reduce((m, s) => Math.max(m, s.tMs + s.durMs), 0);
    S.talk = { entries, endMs, totalMs: d.totalMs || endMs };
    S.failed = false; // user action acknowledged the error; show the reply
    say("Talking back.");
    draw();
  });

  // Keep the picture truthful on resize: redraw from stored data.
  new ResizeObserver(() => requestAnimationFrame(size)).observe(el);

  size();
  say("Sound ribbon ready.");
}
