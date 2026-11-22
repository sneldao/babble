// Speed telemetry — Dev B (docs/redesign/dev-b-ribbon.md).
//
// One small instrument: tokens per second, queue vs decode split, arrival
// proof. Drawn as a dot-matrix display — the beat-machine idea (content
// rendered at full resolution to an offscreen mask canvas, then resampled
// one dot per grid cell) reimplemented here in Canvas2D.

const MONO = `"Kode Mono", ui-monospace, monospace`;
const CELL = 5;          // css px per dot cell
const BOOT_MS = 800;

function hash01(x, y) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) / 4294967295;
}

function fmtTps(tps) {
  if (tps == null || !isFinite(tps)) return "— tok/s";
  return `${Math.round(tps).toLocaleString("en-US")} tok/s`;
}

function fmtS(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function mount(el, stage) {
  const canvas = document.createElement("canvas");
  canvas.className = "telemetry-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Telemetry: decode speed in tokens per second");
  el.appendChild(canvas);
  const status = document.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("aria-live", "polite");
  el.appendChild(status);

  const ctx = canvas.getContext("2d");
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const lanes = {
    cerebras: blankLane(),
    groq: blankLane(),
  };
  function blankLane() {
    return { phase: "idle", tps: null, queueMs: null, decodeMs: null, tokens: null, replay: false, t0: 0, failed: false };
  }

  let raceOn = false;
  let bootT0 = performance.now();
  let booted = RM; // reduced motion: show settled immediately
  let raf = 0;
  let colors = {};

  function readColors() {
    const cs = getComputedStyle(el);
    colors = {
      paper: cs.getPropertyValue("--paper").trim() || "#f3ecdf",
      ink: cs.getPropertyValue("--ink").trim() || "#1c1a17",
      ink2: cs.getPropertyValue("--ink-2").trim() || "#6b645a",
      signal: cs.getPropertyValue("--signal").trim() || "#e4572e",
      rival: cs.getPropertyValue("--rival").trim() || "#4a4e9e",
    };
  }
  readColors();

  function size() {
    const w = Math.max(50, el.clientWidth);
    const h = Math.max(50, el.clientHeight || 120);
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

  function say(msg) { status.textContent = msg; }

  // --- text mask -----------------------------------------------------------

  function paintMask(now) {
    const w = W(), h = H();
    const dpr = Math.min(2, devicePixelRatio || 1);
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = colors.paper;
    mctx.fillRect(0, 0, w, h);
    mctx.textBaseline = "top";

    const c = lanes.cerebras;
    // Big figure.
    mctx.fillStyle = colors.ink;
    mctx.font = `26px ${MONO}`;
    const big = c.replay ? "REPLAY" : fmtTps(c.tps);
    mctx.fillText(big, 10, 8);

    // Queue lamp, top right: lit while queued.
    const lampOn = c.phase === "queued";
    mctx.fillStyle = lampOn ? colors.signal : "rgba(28,26,23,0.25)";
    mctx.beginPath();
    mctx.arc(w - 76, 20, 5, 0, 7);
    mctx.fill();
    mctx.fillStyle = colors.ink2;
    mctx.font = `10px ${MONO}`;
    const lampWord = lampOn ? `queue ${fmtS(now - c.t0)}` : c.phase === "idle" ? "idle" : c.phase;
    mctx.fillText(lampWord.toUpperCase().slice(0, 14), w - 66, 14);

    // Queue / decode split — never folded into the speed figure.
    mctx.fillStyle = colors.ink2;
    mctx.font = `11px ${MONO}`;
    let small;
    if (c.failed && c.phase === "error") small = "decode failed · capture kept";
    else if (c.phase === "queued") small = `queue ${fmtS(now - c.t0)} ····`;
    else if (c.queueMs != null) small = `queue ${fmtS(c.queueMs)} · decode ${fmtS(c.decodeMs ?? 0)}`;
    else small = "queue — · decode —";
    mctx.fillText(small, 10, 42);

    // Tokens line.
    mctx.fillStyle = colors.ink2;
    if (c.replay) mctx.fillText("recorded reply · no tok/s", 10, 58);
    else if (c.tokens != null) mctx.fillText(`${c.tokens} tokens`, 10, 58);

    // Race lane: its own row, in rival colour.
    if (raceOn) {
      const g = lanes.groq;
      mctx.fillStyle = colors.rival;
      mctx.font = `13px ${MONO}`;
      const gbig = g.replay ? "groq REPLAY" : `groq ${fmtTps(g.tps)}`;
      mctx.fillText(gbig, 10, 76);
      mctx.font = `10px ${MONO}`;
      let gsmall = "groq ";
      if (g.phase === "queued") gsmall += `queue ${fmtS(now - g.t0)} ····`;
      else if (g.queueMs != null) gsmall += `queue ${fmtS(g.queueMs)} · decode ${fmtS(g.decodeMs ?? 0)}`;
      else gsmall += "—";
      mctx.fillText(gsmall, 10, 96);
    }

    // Field label, bottom right.
    mctx.fillStyle = colors.ink2;
    mctx.font = `10px ${MONO}`;
    const tag = "TOK/S · FIELD UNIT 01";
    mctx.fillText(tag, w - 10 - mctx.measureText(tag).width, h - 16);
  }

  function drawDots(reveal) {
    const w = W(), h = H();
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, w, h);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const data = mctx.getImageData(0, 0, mask.width, mask.height).data;
    const at = (x, y) => {
      const px = Math.min(mask.width - 1, Math.floor(x * dpr));
      const py = Math.min(mask.height - 1, Math.floor(y * dpr));
      const i = (py * mask.width + px) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    // Paper rgb for the background test.
    const bg = at(0, 0);
    const cols = Math.floor(w / CELL), rows = Math.floor(h / CELL);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (reveal < 1 && hash01(gx, gy) > reveal) continue;
        const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
        const [r, g, b, a] = at(x, y);
        if (a < 100) continue;
        const dr = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
        if (dr < 60) continue; // paper: leave the dot out
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(x, y, CELL * 0.34, 0, 7);
        ctx.fill();
      }
    }
  }

  function frame() {
    raf = 0;
    const now = performance.now();
    let reveal = 1;
    if (!booted) {
      reveal = Math.min(1, (now - bootT0) / BOOT_MS);
      if (reveal >= 1) booted = true;
    }
    paintMask(now);
    drawDots(reveal);
    if (!booted || lanes.cerebras.phase === "queued" || (raceOn && lanes.groq.phase === "queued")) {
      raf = requestAnimationFrame(frame);
    }
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
    else { paintMask(performance.now()); drawDots(1); }
  }

  function draw(reveal = 1) {
    paintMask(performance.now());
    drawDots(reveal);
  }

  // --- stage subscriptions -------------------------------------------------

  function reset() {
    lanes.cerebras = blankLane();
    lanes.groq = blankLane();
    raceOn = false;
  }

  stage.on("capture:start", () => { reset(); kick(); });
  stage.on("species", () => { readColors(); kick(); });

  stage.on("interpret:start", (d) => {
    if (d.lane === "cerebras") {
      const keepRace = false;
      lanes.cerebras = { ...blankLane(), phase: "queued", t0: d.t0 || performance.now() };
      if (!keepRace) { lanes.groq = blankLane(); raceOn = false; }
      say("Queued. Counting queue time.");
    } else if (d.lane === "groq") {
      raceOn = true;
      lanes.groq = { ...blankLane(), phase: "queued", t0: d.t0 || performance.now() };
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

  new ResizeObserver(() => size()).observe(el);
  size();
  // Staged boot: dots fill in over ~0.8s (settled at once under RM).
  if (!booted) kick();
  say("Telemetry ready.");
}
