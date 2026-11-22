// Babble character — Dev C (docs/redesign/dev-c-character.md §2).
// Canvas2D face parts, expression table, blink/pop constants and eye
// tracking ported from krisyangdev/jelly `src/face.js` (MIT, © Kris Yang).
// The three.js texture atlas was replaced by direct Canvas2D painting; the
// PAINT table below is the same geometry drawn straight to the canvas.
// Spring integrator from argofowl/ferro-toggle `index.html` (MIT):
//   spring(s, target, w, z, dt) — used for ears, head tilt and squash.
// skate-dog (PolyForm Noncommercial) is an idea reference only; no code taken.

import { stage, SPECIES } from "./stage.js";

const INK = "#1c1a17";          // --ink; kept as a literal for canvas paint
const MOUTH = "#3b2326";
const TONGUE = "#ff8fab";
const BLUSH = "rgba(228,140,120,"; // warm blush tinted toward the paper palette

// ---------- PAINT table (jelly, Canvas2D) ----------
function stroke(g, w, color = INK) {
  g.lineWidth = w; g.strokeStyle = color; g.lineCap = "round"; g.lineJoin = "round"; g.stroke();
}
function bead(g, r) {
  const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
  gr.addColorStop(0, "#3a2a2c"); gr.addColorStop(1, "#120b0c");
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
}
function blushOval(g, a = 0.9) {
  g.save(); g.scale(1, 0.62);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 70);
  gr.addColorStop(0, BLUSH + 0.9 * a + ")"); gr.addColorStop(0.5, BLUSH + 0.5 * a + ")"); gr.addColorStop(1, BLUSH + "0)");
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 70, 0, Math.PI * 2); g.fill();
  g.restore();
}
function whiskers(g, dir) {
  g.beginPath();
  for (const a of [-0.22, 0.08]) { g.moveTo(dir * 66, -6 + a * 40); g.lineTo(dir * 118, -6 + a * 120); }
  stroke(g, 6, "#6e5a55");
}
function dot(g, x, y, r) { g.fillStyle = "#fff"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function wave(g, amp, periods, lw) {
  g.beginPath();
  for (let x = -70; x <= 70; x += 3) {
    const y = -amp * Math.sin((x / 70) * Math.PI * periods);
    x === -70 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  stroke(g, lw, MOUTH);
}
function openMouthPath(g) {
  g.beginPath(); g.moveTo(-64, -34); g.lineTo(64, -34);
  g.bezierCurveTo(60, 30, 30, 70, 0, 70); g.bezierCurveTo(-30, 70, -60, 30, -64, -34); g.closePath();
}

const PAINT = {
  eyeOpen: (g) => bead(g, 60),
  eyeSurprised: (g) => bead(g, 74),
  eyeSquintL: (g) => { g.beginPath(); g.moveTo(-48, -54); g.lineTo(42, 0); g.lineTo(-48, 54); stroke(g, 20); },
  eyeSquintR: (g) => { g.beginPath(); g.moveTo(48, -54); g.lineTo(-42, 0); g.lineTo(48, 54); stroke(g, 20); },
  eyeHappy: (g) => { g.beginPath(); g.arc(0, 30, 50, Math.PI, Math.PI * 2); stroke(g, 18); },
  eyeSleepy: (g) => { g.beginPath(); g.moveTo(-56, -6); g.quadraticCurveTo(0, 34, 56, -6); stroke(g, 16); },
  eyeDizzy: (g) => {
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const t = i / 120, a = t * Math.PI * 6.4, r = 6 + t * 84;
      i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(r, 0);
    }
    stroke(g, 14);
  },
  hlIdle: (g) => { dot(g, -20, -22, 15); dot(g, 18, 20, 6); },
  hlSurprised: (g) => { dot(g, -26, -28, 16); dot(g, 22, 26, 7); },
  cheek: (g) => blushOval(g),
  cheekWL: (g) => { blushOval(g); whiskers(g, -1); },
  cheekWR: (g) => { blushOval(g); whiskers(g, 1); },
  mouthBear: (g) => {
    g.fillStyle = MOUTH; g.beginPath(); g.ellipse(0, -22, 15, 11, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 4);
    g.moveTo(-30, 16); g.quadraticCurveTo(-6, 20, 0, 4); g.quadraticCurveTo(6, 20, 30, 16);
    stroke(g, 10, MOUTH);
  },
  mouthCat: (g) => {
    g.beginPath(); g.arc(-18, -4, 18, 0, Math.PI); g.moveTo(36, -4); g.arc(18, -4, 18, 0, Math.PI);
    stroke(g, 10, MOUTH);
  },
  mouthHappy: (g) => {
    g.save(); openMouthPath(g); g.clip();
    g.fillStyle = MOUTH; g.fillRect(-100, -100, 200, 200);
    g.fillStyle = TONGUE; g.beginPath(); g.ellipse(0, 64, 38, 28, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    openMouthPath(g); stroke(g, 16, MOUTH);
  },
  mouthSquint: (g) => wave(g, 13, 2, 20),
  mouthDizzy: (g) => wave(g, 22, 1, 20),
  mouthSurprised: (g) => {
    g.save(); g.beginPath(); g.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = MOUTH; g.fillRect(-40, -40, 80, 80);
    g.fillStyle = TONGUE; g.beginPath(); g.ellipse(0, 28, 16, 12, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.beginPath(); g.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2); stroke(g, 12, MOUTH);
  },
  mouthSleepy: (g) => { g.beginPath(); g.moveTo(-24, -4); g.quadraticCurveTo(0, 26, 24, -4); stroke(g, 20, MOUTH); },
};

// ---------- EXPR table (jelly) + babble additions ----------
const EXPR = {
  idle:      { eye: () => "eyeOpen", hl: "hlIdle", mouth: null },
  surprised: { eye: () => "eyeSurprised", hl: "hlSurprised", mouth: "mouthSurprised" },
  squint:    { eye: (s) => (s === "L" ? "eyeSquintL" : "eyeSquintR"), mouth: "mouthSquint" },
  happy:     { eye: () => "eyeHappy", mouth: "mouthHappy" },
  dizzy:     { eye: () => "eyeDizzy", mouth: "mouthDizzy" },
  sleepy:    { eye: () => "eyeSleepy", mouth: null },
  // babble additions
  listening: { eye: () => "eyeSurprised", hl: "hlSurprised", mouth: null, ears: "forward", lean: 0.12 },
  waiting:   { eye: () => "eyeOpen", hl: "hlIdle", mouth: null, ears: "cocked", tilt: 0.16 },
};

const POP = 0.15, BLINK = 0.08;

// ferro-toggle spring integrator (MIT)
function spring(s, target, w, z, dt) {
  s.v += (-w * w * (s.x - target) - 2 * z * w * s.v) * dt;
  s.x += s.v * dt;
}
const sp = (x = 0) => ({ x, v: 0 });

// header vocal → expression map (brief §2)
const VOCAL_EXPR = {
  protest: "squint", distress: "squint", alarm: "surprised",
  solicitation: "surprised", hunger: "surprised", attention: "surprised",
  greeting: "happy", play: "happy", contentment: "sleepy",
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- silhouettes: three animals, three path sets ----------
// Each draw fn paints the body centred on (0,0) in a ~unit space scaled by S.
// earL/earR receive {rot, droop} from the springs; ctx is already translated.
function drawCat(g, S, ears, squash, tilt, tongue) {
  // upright triangular ears
  for (const [sx, e] of [[-1, ears.l], [1, ears.r]]) {
    g.save(); g.translate(sx * 52, -78); g.rotate(e.rot * sx);
    g.beginPath(); g.moveTo(-26, 14); g.quadraticCurveTo(-6 + e.droop * 6, -46, 8, -52);
    g.quadraticCurveTo(24, -34, 26, 12); g.closePath();
    g.fillStyle = S.fill; g.fill(); stroke(g, 5);
    g.fillStyle = "#e9b8a6"; g.beginPath();
    g.moveTo(-10, 8); g.quadraticCurveTo(0 + e.droop * 4, -28, 8, -34); g.quadraticCurveTo(14, -20, 14, 6); g.closePath(); g.fill();
    g.restore();
  }
  body(g, S, squash, tilt, 96, 88);
  // whisker cheeks + ω mouth
  cheeks(g, S, true);
  if (tongue) { g.fillStyle = TONGUE; g.beginPath(); g.ellipse(0, 26, 12, 16, 0, 0, Math.PI * 2); g.fill(); }
  PAINT.mouthCat(g);
  face(g, S);
}
function drawDog(g, S, ears, squash, tilt, tongue) {
  // long head with muzzle; floppy ears hang and swing
  for (const [sx, e] of [[-1, ears.l], [1, ears.r]]) {
    g.save(); g.translate(sx * 74, -52); g.rotate(e.rot * sx + e.droop * 0.5 * sx);
    g.beginPath(); g.moveTo(-4, -22); g.bezierCurveTo(34, -30, 44, 24, 26, 74 + e.droop * 30);
    g.bezierCurveTo(16, 88, -8, 80, -10, 58); g.closePath();
    g.fillStyle = shade(S.fill, -0.18); g.fill(); stroke(g, 5);
    g.restore();
  }
  body(g, S, squash, tilt, 104, 92, true);
  // nose on the muzzle
  g.fillStyle = MOUTH; g.beginPath(); g.ellipse(0, 6, 16, 12, 0, 0, Math.PI * 2); g.fill();
  dot(g, -5, 3, 3.4); dot(g, 5, 3, 3.4);
  if (tongue) { g.fillStyle = TONGUE; g.beginPath(); g.ellipse(0, 30, 14, 20, 0, 0, Math.PI * 2); g.fill(); }
  PAINT.mouthBear(g);
  face(g, S, 0, -34); // eyes sit higher, above the muzzle
}
function drawInfant(g, S, ears, squash, tilt, tongue) {
  // hair tuft idles like a tail would
  g.save(); g.translate(0, -92); g.rotate(Math.sin(S.t * 0.0021) * 0.18);
  g.beginPath(); g.moveTo(-8, 10); g.bezierCurveTo(-14, -18, 2, -26, 10, -8);
  g.bezierCurveTo(14, 0, 8, 8, 2, 10); g.closePath();
  g.fillStyle = shade(S.fill, -0.25); g.fill(); stroke(g, 4);
  g.restore();
  // small ears at the sides, no animal ears
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(sx * 92, -6, 16, 24, sx * 0.3, 0, Math.PI * 2);
    g.fillStyle = S.fill; g.fill(); stroke(g, 5);
  }
  body(g, S, squash, tilt, 92, 86);
  cheeks(g, S, false);
  if (tongue) { g.fillStyle = TONGUE; g.beginPath(); g.ellipse(0, 24, 10, 13, 0, 0, Math.PI * 2); g.fill(); }
  PAINT.mouthSurprised(g);
  face(g, S);
}
function body(g, S, squash, tilt, rx, ry, muzzle = false) {
  g.save(); g.rotate(tilt); g.scale(1 + squash, 1 - squash);
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = S.fill; g.fill(); stroke(g, 5);
  if (muzzle) { g.beginPath(); g.ellipse(0, 22, 44, 34, 0, 0, Math.PI * 2); g.fillStyle = shade(S.fill, 0.12); g.fill(); stroke(g, 4); }
  g.restore();
}
function cheeks(g, S, whisker) {
  for (const [sx, name] of [[-1, whisker ? "cheekWL" : "cheek"], [1, whisker ? "cheekWR" : "cheek"]]) {
    g.save(); g.translate(sx * 62, 26); g.scale(S.k, S.k); PAINT[name](g); g.restore();
  }
}
function face(g, S, dx = 0, dy = 0) {
  // eyes + highlights, offset by gaze and blink
  const e = EXPR[S.expr] ?? EXPR.idle;
  for (const sx of [-1, 1]) {
    g.save();
    g.translate(sx * 34 + S.gaze.x * 9 + dx, -30 + S.gaze.y * 7 + dy);
    const side = sx < 0 ? "L" : "R";
    g.scale(S.pop * S.blink, S.pop * S.blink);
    PAINT[e.eye(side)](g);
    if (e.hl) { g.save(); PAINT[e.hl](g); g.restore(); }
    g.restore();
  }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => clamp(Math.round(v + amt * 255), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const DRAW = { cat: drawCat, dog: drawDog, infant: drawInfant };

// ---------- module state ----------
export function mount(el, st) {
  el.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "Character");
  el.appendChild(canvas);
  const g = canvas.getContext("2d");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const S = {
    t: 0,
    species: st.species,
    expr: "idle",
    pop: 1, blink: 1,
    gaze: { x: 0, y: 0 }, gazeT: { x: 0, y: 0 },
    earL: sp(0), earR: sp(0), droopL: sp(0), droopR: sp(0),
    tilt: sp(0), squash: sp(0), lean: sp(0),
    mouthOpen: 0, mouthLevel: 0, // listening: follows analyser RMS
    blush: 0, blushT: 0,
    holdUntil: 0, sleepyAt: Infinity,
    analyser: null, td: new Uint8Array(2048),
    attack: 0, release: 0,
    swap: null, // { to } mid-swap
  };

  let fill = "#e4572e";
  function readSignal() {
    fill = getComputedStyle(document.body).getPropertyValue("--signal").trim() || "#e4572e";
  }
  readSignal();

  function setExpr(name) {
    if (!EXPR[name] || S.expr === name) return;
    S.expr = name;
    S.pop = 0; // pop scale on change (jelly)
  }

  // ---------- stage wiring ----------
  const unsubs = [
    st.on("state", ({ state }) => {
      wake();
      if (state === "idle" || state === "done") { if (S.expr !== "sleepy") scheduleSleepy(); }
      if (state === "listening") { setExpr("listening"); S.analyser = null; }
      if (state === "queued") setExpr("waiting");
      if (state === "error") { setExpr("dizzy"); S.holdUntil = S.t + 1500; }
    }),
    st.on("species", ({ species }) => {
      wake();
      // squash out, swap silhouette, spring in
      S.swap = { to: species };
    }),
    st.on("capture:start", ({ analyser }) => {
      wake(); setExpr("listening");
      S.analyser = analyser ?? null;
      S.mouthLevel = 0;
    }),
    st.on("analysis", () => { wake(); S.nodT = 0; }), // single nod
    st.on("interpret:header", ({ vocal, confidence }) => {
      wake();
      const name = VOCAL_EXPR[vocal] ?? "idle";
      if (name === "surprised" && ["solicitation", "hunger", "attention"].includes(vocal)) {
        setExpr("surprised");
        setTimeout(() => setExpr("happy"), 450); // surprised then happy
      } else setExpr(name);
      S.blushT = confidence == null ? 0.35 : clamp(confidence, 0, 1); // blush scales with confidence
    }),
    st.on("interpret:delta", () => { wake(); S.mouthOpen = Math.min(1, S.mouthOpen + 0.45); }),
    st.on("interpret:done", () => { wake(); S.holdUntil = S.t + 2000; }),
    st.on("interpret:error", () => { wake(); setExpr("dizzy"); S.holdUntil = S.t + 1500; }),
    st.on("vocalize:play", ({ schedule }) => {
      wake();
      S.tiltT = 1; // turn toward the sound
      S.syllables = schedule.map((s) => ({ at: s.tMs, done: false }));
      const sp2 = st.species;
      S.endReact = sp2 === "cat" ? "slowblink" : sp2 === "dog" ? "happy" : "surprised";
    }),
  ];

  function wake() {
    S.sleepyAt = S.t + 20000;
    if (S.expr === "sleepy") setExpr("idle");
  }
  function scheduleSleepy() { S.sleepyAt = S.t + 20000; }

  // pointer tracking
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    S.gazeT.x = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
    S.gazeT.y = clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
  };
  addEventListener("pointermove", onMove);

  // ---------- resize ----------
  function resize() {
    const r = el.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  // ---------- frame ----------
  let last = performance.now();
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    S.t = now;

    // sleepy after 20s idle
    if (S.t > S.sleepyAt && ["idle", "done"].includes(st.state)) setExpr("sleepy");

    // listening: mouth follows analyser RMS, fast attack slower release
    if (S.analyser && st.state === "listening") {
      S.analyser.getByteTimeDomainData(S.td);
      let sum = 0;
      for (let i = 0; i < S.td.length; i += 4) { const v = (S.td[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / (S.td.length / 4));
      const level = clamp(rms * 6, 0, 1);
      if (level > S.mouthLevel) S.mouthLevel += (level - S.mouthLevel) * Math.min(1, dt * 30);
      else S.mouthLevel += (level - S.mouthLevel) * Math.min(1, dt * 6);
      // ear twitch on level peaks
      if (level > 0.55 && S.t - (S._twitch || 0) > 260) {
        S._twitch = S.t;
        (Math.random() < 0.5 ? S.earL : S.earR).v += 14;
      }
    } else if (st.state !== "streaming") {
      S.mouthLevel += (0 - S.mouthLevel) * Math.min(1, dt * 8);
    }

    // speaking: per-delta mouth movement decays
    if (st.state === "streaming") S.mouthOpen += (0 - S.mouthOpen) * Math.min(1, dt * 5);
    else if (st.state !== "listening") S.mouthOpen += (0 - S.mouthOpen) * Math.min(1, dt * 10);

    // species swap: squash out, swap, spring in
    if (S.swap) {
      S.squash.v -= 26 * dt;
      if (S.squash.x < -0.55) { S.species = S.swap.to; readSignal(); S.swap = null; S.squash.v = 8; }
    }

    // springs (skipped under reduced motion)
    if (!reduced) {
      const e = EXPR[S.expr] ?? EXPR.idle;
      const earTarget = e.ears === "forward" ? -0.22 : e.ears === "cocked" ? 0.34 : 0;
      spring(S.earL, earTarget, 9, 0.55, dt);
      spring(S.earR, earTarget + (e.ears === "cocked" ? 0.18 : 0), 8.5, 0.5, dt);
      spring(S.droopL, 0, 6, 0.5, dt);
      spring(S.droopR, 0, 6, 0.5, dt);
      spring(S.tilt, e.tilt ?? (S.tiltT ? 0.1 : 0), 5, 0.6, dt);
      S.tiltT = 0;
      spring(S.lean, e.lean ?? 0, 6, 0.6, dt);
      // breathing: slow 2% squash (idle-ish states only)
      const breathe = ["idle", "done", "queued"].includes(st.state) ? Math.sin(S.t * 0.0011) * 0.02 : 0;
      spring(S.squash, breathe, 7, 0.7, dt);
      // gaze smoothing (exponential, jelly)
      if (!reduced) {
        S.gaze.x += (S.gazeT.x - S.gaze.x) * Math.min(1, dt * 6);
        S.gaze.y += (S.gazeT.y - S.gaze.y) * Math.min(1, dt * 6);
      }
      // blink: 0.08s, every 2–5s, idle only (jelly)
      if (["idle", "done", "queued", "listening"].includes(st.state)) {
        if (S.blinkT === undefined) S.blinkT = -1;
        if (S.blinkT < 0 && (S.nextBlink = (S.nextBlink ?? 2) - dt) <= 0) { S.blinkT = 0; S.nextBlink = 2 + Math.random() * 3; }
        if (S.blinkT >= 0) {
          S.blinkT += dt;
          const p = S.blinkT / BLINK;
          if (p >= 1) S.blinkT = -1; else S.blink = 1 - 0.92 * Math.sin(Math.PI * p);
        } else S.blink = 1;
      }
      // pop (jelly)
      if (S.pop < 1) S.pop = Math.min(1, S.pop + dt / POP);
    } else {
      S.pop = 1; S.blink = 1;
      // reduced motion: keep blinking via a simple toggle
      if (((S.t / 3000) | 0) !== (S._lastBlinkSlot ?? -1)) { S._lastBlinkSlot = (S.t / 3000) | 0; S.blink = 0.08; }
      if (S.blink < 1) S.blink = Math.min(1, S.blink + dt * 12);
    }

    // hold expression then idle
    if (S.holdUntil && S.t > S.holdUntil && st.state !== "error") {
      S.holdUntil = 0;
      if (!["listening", "queued"].includes(st.state)) setExpr("idle");
    }
    if (st.state === "done" && S.holdUntil === 0 && S.expr !== "sleepy") scheduleSleepy();

    // vocalize syllable perks + end reaction
    if (S.syllables) {
      const t0 = S.vocalStart ?? 0;
      for (const s of S.syllables) {
        if (!s.done && S.t - t0 >= s.at) { s.done = true; S.earL.v += 10; S.earR.v += 10; S.mouthOpen = 0.7; }
      }
      if (S.vocalStart && S.t - t0 > (S.vocalTotal ?? 0) + 300 && S.endReact) {
        if (S.endReact === "slowblink") { S.blinkT = 0; S.blinkHold = true; }
        else setExpr(S.endReact);
        S.endReact = null; S.syllables = null;
        if (S.blinkHold) { setTimeout(() => { S.blinkHold = false; }, 400); }
      }
    }

    // blush decay (jelly: decays over ~1.5s toward base)
    S.blush += (S.blushT - S.blush) * Math.min(1, dt * 2);
    S.blushT += (0.12 - S.blushT) * Math.min(1, dt * 0.8);

    // nod on analysis
    let nod = 0;
    if (S.nodT !== undefined && S.nodT < 0.5) { nod = Math.sin(S.nodT / 0.5 * Math.PI) * 0.12; S.nodT += dt; }

    // ---------- paint ----------
    const w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    const scale = Math.min(w / 340, h / 320) * 0.92;
    g.save();
    g.translate(w / 2, h * 0.56);
    g.scale(scale, scale);
    g.rotate(nod + (reduced ? 0 : S.tilt.x * 0.35) + (reduced ? 0 : S.lean.x * 0.12));
    const squash = reduced ? 0 : S.squash.x;
    g.scale(1 + squash, 1 - squash);

    const ears = { l: { rot: S.earL.x, droop: S.droopL.x }, r: { rot: S.earR.x, droop: S.droopR.x } };
    const tongue = S.expr === "happy" || S.mouthLevel > 0.6;
    DRAW[S.species](g, { fill, k: 1, t: S.t, gaze: S.gaze, pop: S.pop, blink: S.blink }, ears, squash, 0, tongue);

    // mouth open overlay while listening/speaking: darken an ellipse under the mouth
    const mo = clamp(S.mouthLevel * 1.2 + S.mouthOpen, 0, 1);
    if (mo > 0.05) {
      g.save(); g.globalAlpha = mo * 0.85;
      g.fillStyle = MOUTH;
      g.beginPath(); g.ellipse(0, 18, 16 + mo * 14, 6 + mo * 20, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // blush
    if (S.blush > 0.03) {
      for (const sx of [-1, 1]) {
        g.save(); g.translate(sx * 62, 30); g.scale(0.5, 0.5);
        g.globalAlpha = S.blush; blushOval(g, S.blush); g.restore();
      }
    }
    g.restore();
  }
  raf = requestAnimationFrame(frame);

  return () => { // teardown (harness remounts)
    cancelAnimationFrame(raf);
    ro.disconnect();
    removeEventListener("pointermove", onMove);
    for (const u of unsubs) u();
  };
}
