// Speed telemetry — Dev B (docs/redesign/dev-b-ribbon.md).
//
// One small instrument: tokens per second as a dot-matrix figure (the
// beat-machine resample idea in Canvas2D, cell 4 css px, mask text >= 48 px
// so digits read at 11+ dots). Everything else is real mono DOM text under
// the display — legible at 100% zoom.

const MONO = `"Kode Mono", ui-monospace, monospace`;
const CELL = 4;
const BOOT_MS = 800;

function hash01(x, y) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) / 4294967295;
}

const fmtS = (ms) => `${(ms / 1000).toFixed(2)} s`;

export function mount(el, stage) {
  el.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "telemetry-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Telemetry: decode speed in tokens per second");
  const text = document.createElement("div");
  text.className = "telemetry-text";
  const line1 = document.createElement("div");
  const line2 = document.createElement("div");
  const line3 = document.createElement("div");
  const tok = document.createElement("div");
  tok.className = "telemetry-unit";
  tok.textContent = "TOK/S";
  text.append(tok, line1, line2, line3);
  const status = document.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("aria-live", "polite");
  el.append(canvas, text, status);

  const ctx = canvas.getContext("2d");
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const lanes = { cerebras: blank(), rival: blank() };
  function blank() {
    return { phase: "idle", tps: null, queueMs: null, decodeMs: null, tokens: null, replay: false, t0: 0, failed: false };
  }

  let raceOn = false;
  let bootT0 = performance.now();
  let booted = RM;
  let raf = 0;
  let colors = {};

  function readColors() {
    const cs = getComputedStyle(el);
    colors = {
      ink: cs.getPropertyValue("--ink").trim() || "#1c1a17",
      ink2: cs.getPropertyValue("--ink-2").trim() || "#6b645a",
      signal: cs.getPropertyValue("--signal").trim() || "#e4572e",
      rival: cs.getPropertyValue("--rival").trim() || "#4a4e9e",
      warn: cs.getPropertyValue("--warn").trim() || "#b3261e",
    };
  }
  readColors();

  function size() {
    const w = Math.max(50, canvas.clientWidth || el.clientWidth);
    const h = Math.max(44, canvas.clientHeight || 84);
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    mask.width = canvas.width;
    mask.height = canvas.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(1);
  }
  const W = () => canvas.width / Math.min(2, devicePixelRatio || 1);
  const H = () => canvas.height / Math.min(2, devicePixelRatio || 1);
  const say = (m) => { status.textContent = m; };

  function paintMask() {
    // Same dpr drift guard as the ribbon: a backing store fitted under a
    // different devicePixelRatio renders at the wrong scale.
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.max(50, canvas.clientWidth || el.clientWidth);
    const ch = Math.max(44, canvas.clientHeight || 84);
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      size();
      return;
    }
    const w = W(), h = H();
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = "#fff";
    mctx.fillRect(0, 0, w, h);
    const c = lanes.cerebras;
    const tps = c.replay ? null : c.tps;
    if (tps == null || !isFinite(tps)) {
      // No figure: two clean dashes as plain bars of lit dots, 3 cells thick,
      // vertically centred — never glyph text, which resamples into noise.
      const bh = CELL * 3, bw = Math.min(36, w * 0.16);
      const gap = bw * 0.9;
      const x0 = 12 + Math.max(0, (w - 24 - bw * 2 - gap) / 2);
      const y = h / 2 - bh / 2;
      mctx.fillStyle = "#000";
      mctx.fillRect(x0, y, bw, bh);
      mctx.fillRect(x0 + bw + gap, y, bw, bh);
      return;
    }
    const big = String(Math.round(tps));
    // Digits only, as large as fits; the TOK/S unit is DOM text below.
    let fs = Math.min(56, h - 12);
    mctx.fillStyle = "#000";
    mctx.textBaseline = "middle";
    for (let pass = 0; pass < 4; pass++) {
      mctx.font = `700 ${fs}px ${MONO}`;
      const bw = mctx.measureText(big).width;
      if (12 + bw + 10 <= w || fs <= 18) break;
      fs *= (w - 22) / bw;
    }
    mctx.font = `700 ${fs}px ${MONO}`;
    mctx.fillText(big, 12, h / 2 + 1);
  }

  function drawDots(reveal) {
    const w = W(), h = H();
    ctx.fillStyle = colors.paper2 || "#e9e0cf";
    ctx.fillRect(0, 0, w, h);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const data = mctx.getImageData(0, 0, mask.width, mask.height).data;
    const lit = (x, y) => {
      const px = Math.min(mask.width - 1, Math.floor(x * dpr));
      const py = Math.min(mask.height - 1, Math.floor(y * dpr));
      return data[(py * mask.width + px) * 4 + 3] > 100 && data[(py * mask.width + px) * 4] < 128;
    };
    const cols = Math.floor(w / CELL), rows = Math.floor(h / CELL);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (reveal < 1 && hash01(gx, gy) > reveal) continue;
        const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
        const on = lit(x, y);
        ctx.fillStyle = on ? colors.ink : "rgba(28,26,23,0.08)";
        ctx.beginPath();
        ctx.arc(x, y, CELL * 0.34, 0, 7);
        ctx.fill();
      }
    }
  }

  function renderText(now) {
    const c = lanes.cerebras;
    if (c.phase === "queued") {
      line1.textContent = `QUEUE ${fmtS(now - c.t0)}`;
      line1.style.color = colors.signal;
    } else if (c.failed && c.phase === "error") {
      line1.textContent = "decode failed · capture kept";
      line1.style.color = colors.warn;
    } else if (c.replay) {
      line1.textContent = "REPLAY · recorded response";
      line1.style.color = colors.ink2;
    } else if (c.queueMs != null) {
      line1.textContent = `queue ${fmtS(c.queueMs)} · decode ${fmtS(c.decodeMs ?? 0)}`;
      line1.style.color = colors.ink2;
    } else {
      line1.textContent = "ready";
      line1.style.color = colors.ink2;
    }
    line2.textContent = c.replay ? "recorded reply · no tok/s"
      : c.tokens != null ? `${c.tokens} tokens`
      : "";
    line2.style.color = colors.ink2;
    if (raceOn) {
      const g = lanes.rival;
      const gbig = g.failed && g.phase === "error" ? "gpu offline"
        : g.tps != null ? `gpu ${Math.round(g.tps)} tok/s` : "gpu —";
      const gsmall = g.phase === "queued" ? `queue ${fmtS(now - g.t0)}`
        : g.queueMs != null ? `queue ${fmtS(g.queueMs)} · decode ${fmtS(g.decodeMs ?? 0)}` : "";
      line3.textContent = gsmall ? `${gbig} · ${gsmall}` : gbig;
      line3.style.color = colors.rival;
    } else line3.textContent = "";
  }

  function frame() {
    raf = 0;
    const now = performance.now();
    let reveal = 1;
    if (!booted) {
      reveal = Math.min(1, (now - bootT0) / BOOT_MS);
      if (reveal >= 1) booted = true;
    }
    paintMask();
    drawDots(reveal);
    renderText(now);
    if (!booted || lanes.cerebras.phase === "queued" || (raceOn && lanes.rival.phase === "queued")) {
      raf = requestAnimationFrame(frame);
    }
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
    else { paintMask(); drawDots(1); renderText(performance.now()); }
  }
  function draw(reveal = 1) { paintMask(); drawDots(reveal); renderText(performance.now()); }

  stage.on("capture:start", () => {
    lanes.cerebras = blank();
    lanes.rival = blank();
    raceOn = false;
    kick();
  });
  stage.on("species", () => { readColors(); kick(); });
  stage.on("interpret:start", (d) => {
    if (d.lane === "cerebras") {
      lanes.cerebras = { ...blank(), phase: "queued", t0: d.t0 || performance.now() };
      lanes.rival = blank();
      say("Queued. Counting queue time.");
    } else if (d.lane === "rival") {
      raceOn = true;
      lanes.rival = { ...blank(), phase: "queued", t0: d.t0 || performance.now() };
      say("Race on: second lane queued.");
    }
    kick();
  });
  stage.on("interpret:delta", (d) => {
    const L = lanes[d.lane];
    if (!L) return;
    L.phase = "streaming";
    if (typeof d.tps === "number") L.tps = d.tps;
    if (d.lane === "cerebras") say(`Streaming at ${Math.round(L.tps || 0)} tokens per second.`);
    kick();
  });
  stage.on("interpret:done", (d) => {
    const L = lanes[d.lane];
    if (!L) return;
    L.phase = "done";
    L.failed = false;
    L.queueMs = d.queueMs ?? null;
    L.decodeMs = d.decodeMs ?? null;
    L.tokens = d.tokens ?? null;
    if (typeof d.tps === "number") L.tps = d.tps;
    L.replay = !!d.replay;
    if (d.lane === "cerebras") {
      say(d.replay ? "Replay finished." : `Done. Queue ${fmtS(L.queueMs || 0)}, decode ${fmtS(L.decodeMs || 0)}.`);
    }
    kick();
  });
  stage.on("interpret:error", (d) => {
    const L = lanes[d.lane];
    if (!L) return;
    L.phase = "error";
    L.failed = true;
    if (d.lane === "cerebras") say("Interpretation failed.");
    kick();
  });

  new ResizeObserver(() => requestAnimationFrame(size)).observe(el);
  size();
  if (!booted) kick();
  say("Telemetry ready.");
}
