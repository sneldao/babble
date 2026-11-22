import { stage } from "./stage.js";
import { mount as mountRibbon } from "./ribbon.js";
import { mount as mountTelemetry } from "./telemetry.js";
import { mount as mountCharacter } from "./character.js";
import { mount as mountCaptions } from "./captions.js";
import { mount as mountStart } from "./start.js";
import { mount as mountControls } from "./controls.js";
import { interpret, vocalize } from "./api.js";
import { decode, playBuffer } from "./audio.js";
import { analyzeBuffer, captureMic } from "./acoustics.js";
import { playScript } from "./synth.js";

mountRibbon(document.getElementById("ribbon"), stage);
mountTelemetry(document.getElementById("telemetry"), stage);
mountCharacter(document.getElementById("character"), stage);
mountCaptions(document.getElementById("captions"), stage);
mountStart(document.getElementById("start"), stage);
mountControls(document.getElementById("controls"), stage);

let cfg = {};
try {
  cfg = await (await fetch("/api/config")).json();
  document.getElementById("engine").textContent = `${cfg.model} · OpenClaw on Cerebras`;
} catch {
  document.getElementById("engine").textContent = "engine offline";
}

const startEl = document.getElementById("start");
if (!startEl.children.length) stage.set("idle");
stage.on("intent:start", () => {
  if (stage.state === "boot") stage.set("idle");
});

const log = document.getElementById("log");
const logList = document.getElementById("logList");
const logToggle = document.getElementById("logToggle");

function toggleLog() {
  const open = log.classList.toggle("open");
  logToggle.setAttribute("aria-expanded", String(open));
}
logToggle.addEventListener("click", toggleLog);
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "l" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
  toggleLog();
});

stage.on("interpret:done", (d) => {
  if (d.lane !== "cerebras") return;
  const li = document.createElement("li");
  li.textContent = `${stage.species} · ${d.text}${d.replay ? " (replay)" : ""}`;
  logList.appendChild(li);
});
stage.on("reply:sent", (d) => {
  const li = document.createElement("li");
  li.textContent = `you · ${d.text}`;
  logList.appendChild(li);
});

// ---------- session state ----------
let race = false;
let camOn = false;
let camStream = null;
let history = [];
let last = null;               // { source, clip, buffer, features }
let current = [];              // in-flight interpret promises
let replayTimers = [];
let runSeq = 0;

const BUSY = ["listening", "analysing", "queued", "streaming"];
const busy = () => BUSY.includes(stage.state);

function cancelInFlight() {
  runSeq++;
  for (const p of current) p.abort?.();
  current = [];
  for (const t of replayTimers) clearTimeout(t);
  replayTimers = [];
}

const guard = (fn) => async (detail) => {
  try {
    await fn(detail || {});
  } catch (e) {
    console.error(e);
    stage.set("error", { reason: "internal" });
  }
};

// ---------- capture ----------
async function captureClip(file, species) {
  if (species) stage.setSpecies(species);
  const buf = await decode(await (await fetch("/clips/" + file)).arrayBuffer());
  const { analyser, startedAt, durationMs } = playBuffer(buf);
  stage.set("listening");
  stage.emit("capture:start", { source: "clip", analyser, startedAt, durationMs });
  return { source: "clip", clip: file, buffer: buf };
}

async function captureMicRun(secs) {
  stage.set("listening");
  const t0 = performance.now();
  let r;
  try {
    r = await captureMic(secs);
  } catch (e) {
    stage.set("error", { reason: "mic", message: e.message });
    return null;
  }
  let buffer;
  if (r && r.done) {
    stage.emit("capture:start", { source: "mic", analyser: r.analyser, startedAt: r.startedAt, durationMs: secs * 1000 });
    buffer = await r.done;
  } else {
    stage.emit("capture:start", { source: "mic", analyser: null, startedAt: t0, durationMs: secs * 1000 });
    buffer = r;
  }
  return { source: "mic", buffer };
}

async function captureFile(file) {
  const buffer = await decode(await file.arrayBuffer());
  stage.set("listening");
  stage.emit("capture:start", { source: "file", analyser: null, startedAt: performance.now(), durationMs: buffer.duration * 1000 });
  return { source: "file", buffer };
}

// ---------- interpretation ----------
async function playReplay(rec, waitedMs) {
  stage.emit("interpret:header", { lane: "cerebras", ...rec.header });
  stage.set("streaming");
  const t0 = performance.now();
  const seq = runSeq;
  let text = "";
  await new Promise((resolve) => {
    rec.deltas.forEach((d, i) => {
      replayTimers.push(setTimeout(() => {
        if (seq !== runSeq) return resolve();
        text += d.text;
        const tps = Math.round(text.length / 4) / Math.max(0.05, (performance.now() - t0) / 1000);
        stage.emit("interpret:delta", { lane: "cerebras", text: d.text, t: performance.now(), first: i === 0, tps });
        if (i === rec.deltas.length - 1) resolve();
      }, d.tMs));
    });
    if (!rec.deltas.length) resolve();
  });
  if (seq !== runSeq) return false;
  stage.emit("interpret:done", {
    lane: "cerebras", text,
    queueMs: waitedMs, decodeMs: rec.decodeMs || text.length * 12,
    tokens: Math.round(text.length / 4),
    tps: Math.round(text.length / 4) / Math.max(0.05, (performance.now() - t0) / 1000),
    replay: true,
  });
  if (text.trim()) history.push(`${stage.species}: "${text.trim()}"`);
  stage.set("done");
  return true;
}

async function run(cap) {
  cancelInFlight();
  const seq = runSeq;
  const payload = { species: stage.species, features: cap.features, image: grabFrame(), history };
  stage.set("queued");
  const t0 = performance.now();
  stage.emit("interpret:start", { lane: "cerebras", t0 });

  const wire = (lane) => interpret(payload, {
    lane,
    budgetMs: lane === "cerebras" && cfg.record ? 180000 : 12000,
    on: lane === "cerebras" ? {
      header: (h) => stage.emit("interpret:header", { lane, ...h }),
      delta: (d) => {
        if (stage.state === "queued") stage.set("streaming");
        stage.emit("interpret:delta", { lane, ...d });
      },
    } : {
      header: (h) => stage.emit("interpret:header", { lane, ...h }),
      delta: (d) => stage.emit("interpret:delta", { lane, ...d }),
    },
  });

  const c = wire("cerebras");
  current.push(c);
  if (race) {
    const g = wire("groq");
    current.push(g);
    stage.emit("interpret:start", { lane: "groq", t0 });
    g.then((r) => {
      if (seq !== runSeq) return;
      if (r.ok) {
        stage.emit("interpret:done", {
          lane: "groq", text: r.text, queueMs: r.queueMs, decodeMs: r.decodeMs,
          tokens: r.tokens, tps: r.tps, replay: false,
        });
      } else {
        stage.emit("interpret:error", { lane: "groq", reason: r.reason, status: r.status });
      }
    });
  }

  const r = await c;
  if (seq !== runSeq) return;
  if (r.ok) {
    stage.emit("interpret:done", {
      lane: "cerebras", text: r.text, queueMs: r.queueMs, decodeMs: r.decodeMs,
      tokens: r.tokens, tps: r.tps, replay: false,
    });
    if (r.text.trim()) history.push(`${stage.species}: "${r.text.trim()}"`);
    stage.set("done");
    if (cfg.record && cap.source === "clip") {
      fetch("/api/dev/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clip: cap.clip, species: stage.species, header: r.header,
          deltas: r.deltas, queueMs: r.queueMs, decodeMs: r.decodeMs,
        }),
      }).then((res) => console.info("[replay record]", res.status, cap.clip))
        .catch((e) => console.warn("[replay record]", e));
    }
    return;
  }

  stage.emit("interpret:error", { lane: "cerebras", reason: r.reason, status: r.status });
  if (cap.source === "clip") {
    try {
      const res = await fetch("/replays/" + cap.clip.replace(/\.wav$/, "") + ".json");
      if (res.ok && seq === runSeq) {
        const rec = await res.json();
        if (await playReplay(rec, performance.now() - t0)) return;
      }
    } catch {}
  }
  if (seq === runSeq) stage.set("error", { reason: r.reason, retry: true });
}

async function captureThenRun(promiseCap) {
  const cap = await promiseCap;
  if (!cap) return;
  stage.set("analysing");
  const features = analyzeBuffer(cap.buffer);
  cap.features = features;
  stage.emit("analysis", { features, buffer: cap.buffer });
  if (features.f0Median === 0) {
    stage.set("error", { reason: "unvoiced" });
    return;
  }
  last = cap;
  await run(cap);
}

stage.on("intent:clip", guard((d) => {
  if (busy()) return;
  return captureThenRun(captureClip(d.file, d.species));
}));
stage.on("intent:listen", guard((d) => {
  if (busy()) return;
  return captureThenRun(captureMicRun(d.secs || 3));
}));
stage.on("intent:file", guard((d) => {
  if (busy()) return;
  return captureThenRun(captureFile(d.file));
}));
stage.on("intent:retry", guard(() => {
  if (busy() || !last) return;
  return run(last);
}));

// ---------- talk back ----------
stage.on("intent:reply", guard(async (d) => {
  const text = String(d.text || "").trim();
  if (!text) return;
  stage.emit("reply:sent", { text });
  history.push(`you: "${text}"`);
  const r = await vocalize({ text, species: stage.species });
  if (!r.ok) {
    stage.emit("vocalize:error", { reason: r.reason });
    return;
  }
  const p = playScript(r.script);
  let schedule, startedAt, totalMs;
  if (typeof p === "number") {
    let at = 0;
    schedule = r.script.map((s) => {
      const dur = Math.min(1.4, Math.max(0.08, s.dur || 0.3));
      const entry = { tMs: at * 1000, durMs: dur * 1000, type: s.type, shape: s.shape, pitch: s.pitch, gloss: s.gloss };
      at += dur + 0.09;
      return entry;
    });
    startedAt = performance.now();
    totalMs = p * 1000;
  } else {
    ({ schedule, startedAt, totalMs } = p);
  }
  stage.emit("vocalize:play", { script: r.script, schedule, startedAt, totalMs });
}));

// ---------- race / webcam ----------
stage.on("intent:race", (d) => { race = !!d.on; });
stage.on("intent:cam", guard(async (d) => {
  if (camOn && !d.on) {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    document.getElementById("camView").classList.remove("on");
    camOn = false;
    return;
  }
  if (!camOn && d.on) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 480 } });
    } catch (e) {
      console.warn("cam:", e.message);
      return;
    }
    const v = document.getElementById("camView");
    v.srcObject = camStream;
    v.classList.add("on");
    camOn = true;
  }
}));

function grabFrame() {
  if (!camOn) return null;
  const v = document.getElementById("camView");
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = Math.round(480 * (v.videoHeight / v.videoWidth || 0.75));
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.6);
}

if (new URLSearchParams(location.search).has("dev")) {
  const { mount } = await import("./dev/intent-bar.js");
  mount(document.body, stage);
}
