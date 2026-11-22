import { stage } from "./stage.js";
import { mount as mountRibbon } from "./ribbon.js";
import { mount as mountTelemetry } from "./telemetry.js";
import { mount as mountCharacter } from "./character.js";
import { mount as mountCaptions } from "./captions.js";
import { mount as mountStart } from "./start.js";
import { mount as mountControls } from "./controls.js";
import { mount as mountSnapshot } from "./snapshot.js";
import { mount as mountDropzone } from "./dropzone.js";
import { interpret, vocalize } from "./api.js";
import { decode, playBuffer, loudestWindow } from "./audio.js";
import { analyzeBuffer, captureMic } from "./acoustics.js";
import { playScript } from "./synth.js";

mountRibbon(document.getElementById("ribbon"), stage);
mountTelemetry(document.getElementById("telemetry"), stage);
mountCharacter(document.getElementById("character"), stage);
mountCaptions(document.getElementById("captions"), stage);
mountStart(document.getElementById("start"), stage);
mountControls(document.getElementById("controls"), stage);
mountSnapshot(document.getElementById("character"), stage);
mountDropzone(stage);

let cfg = {};
try {
  const res = await fetch("api/config");
  if (res.ok) cfg = await res.json();
} catch {}
// Hosted static demo (e.g. GitHub Pages): no server, so no live model. Sample
// clips play their recorded real responses labelled REPLAY; mic, file and
// talk-back show an honest "hosted demo" note. ?demo forces it locally.
if (new URLSearchParams(location.search).has("demo") || !cfg.model) {
  cfg.demo = true;
  document.getElementById("engine").textContent = "hosted demo · recorded answers";
} else {
  document.getElementById("engine").textContent = `${cfg.model} · OpenClaw on Cerebras`;
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
let sessionId = crypto.randomUUID();
let pet = localStorage.getItem(`babble.pet.${stage.species}`) || stage.species;
let turns = 0;
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

function endSession() {
  if (turns > 0) {
    try {
      navigator.sendBeacon("api/session/end", JSON.stringify({ sessionId, pet, species: stage.species }));
    } catch {}
  }
  sessionId = crypto.randomUUID();
  turns = 0;
}
addEventListener("pagehide", endSession);

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
  const buf = await decode(await (await fetch("clips/" + file)).arrayBuffer());
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

// ---------- uploaded media ----------
let portrait = null;   // { dataUrl } from a photo upload; sent with every sound
let mediaUrl = null;   // object URL of the current video upload

function clearMedia() {
  if (mediaUrl) { URL.revokeObjectURL(mediaUrl); mediaUrl = null; }
  portrait = null;
  stage.emit("media:clear");
}

function fileKind(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (file.type.startsWith("video/") || ["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (file.type.startsWith("image/")) return "photo";
  return "audio";
}

async function captureFile(file) {
  const kind = fileKind(file);
  if (file.size > 200 * 1024 * 1024) {
    stage.set("error", { reason: "toobig" });
    return null;
  }

  if (kind === "photo") {
    const dataUrl = await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const w = Math.min(480, im.naturalWidth);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = Math.round(w * (im.naturalHeight / im.naturalWidth));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.6));
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
    if (!dataUrl) {
      stage.set("error", { reason: "format" });
      return null;
    }
    clearMedia();
    portrait = { dataUrl };
    const sent = !cfg.demo && cfg.vision !== false;
    stage.emit("media:set", { kind: "photo", url: dataUrl, name: file.name });
    stage.emit("media:frame", { dataUrl, tMs: null, sent, demo: !!cfg.demo });
    return null;
  }

  let buffer;
  try {
    buffer = await decode(await file.arrayBuffer());
  } catch {
    stage.set("error", { reason: kind === "video" ? "nosound" : "format" });
    return null;
  }
  const win = loudestWindow(buffer, 12);
  const cap = { source: "file", buffer: win.buffer, kind, file };
  if (win.fromSec > 0 || buffer.duration > 12) cap.window = win;

  if (kind === "video") {
    clearMedia();
    mediaUrl = URL.createObjectURL(file);
    stage.emit("media:set", { kind: "video", url: mediaUrl, name: file.name, fromSec: win.fromSec });
  }
  const { analyser, startedAt, durationMs } = playBuffer(win.buffer);
  stage.set("listening");
  stage.emit("capture:start", { source: "file", analyser, startedAt, durationMs });
  return cap;
}

// The loudest-moment frame of an uploaded video: a detached seek + grab,
// bounded at 4 s per step; on failure the run just proceeds without an image.
async function grabVideoFrame(file, fromSec, tMs) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("video load")), 4000);
      v.onloadeddata = () => { clearTimeout(to); resolve(); };
      v.onerror = () => { clearTimeout(to); reject(new Error("video load")); };
    });
    const dataUrl = await new Promise((resolve) => {
      const to = setTimeout(() => resolve(null), 4000);
      v.onseeked = () => {
        clearTimeout(to);
        try {
          const w = Math.min(480, v.videoWidth || 480);
          const c = document.createElement("canvas");
          c.width = w;
          c.height = Math.round(w * ((v.videoHeight || 360) / (v.videoWidth || 480)));
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.6));
        } catch { resolve(null); }
      };
      v.currentTime = Math.min(fromSec + tMs / 1000, Math.max(0, (v.duration || 0) - 0.05));
    });
    return dataUrl;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- interpretation ----------
async function playReplay(rec, waitedMs) {
  const replayText = (rec.deltas || []).map((d) => d.text).join("");
  if (!replayText.trim()) return false; // an empty recording is "no replay"
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
    tokensEstimated: true, reasoningTokens: null,
  });
  stage.set("done");
  return true;
}

async function run(cap) {
  cancelInFlight();
  const seq = runSeq;
  const camFrame = grabFrame();
  const imgSrc = cap.image ?? camFrame ?? portrait?.dataUrl ?? null;
  const image = cfg.vision === false || cfg.demo ? null : imgSrc;
  const imageKind = !image ? undefined : cap.image ? "moment" : camFrame ? "cam" : "portrait";
  const payload = { species: stage.species, features: cap.features, image, sessionId, pet };
  if (imageKind) payload.imageKind = imageKind;
  stage.set("queued");
  const t0 = performance.now();
  stage.emit("interpret:start", { lane: "cerebras", t0 });

  if (cfg.demo) {
    if (race) {
      stage.emit("interpret:start", { lane: "rival", t0 });
      stage.emit("interpret:error", { lane: "rival", reason: "demo" });
    }
    if (cap.source === "clip") {
      try {
        const res = await fetch("replays/" + cap.clip.replace(/\.wav$/, "") + ".json");
        if (!res.ok) throw new Error("no replay");
        const rec = await res.json();
        // A short queue beat so WAIT registers, then the recorded stream.
        await new Promise((r) => setTimeout(r, 600 + Math.random() * 500));
        if (seq === runSeq && (await playReplay(rec, performance.now() - t0))) return;
      } catch {}
    }
    stage.emit("interpret:error", { lane: "cerebras", reason: "demo" });
    if (seq === runSeq) stage.set("error", { reason: "demo" });
    return;
  }

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
    const g = wire("rival");
    current.push(g);
    stage.emit("interpret:start", { lane: "rival", t0 });
    g.then((r) => {
      if (seq !== runSeq) return;
      if (r.ok) {
        stage.emit("interpret:done", {
          lane: "rival", text: r.text, queueMs: r.queueMs, decodeMs: r.decodeMs,
          tokens: r.tokens, tps: r.tps, replay: false,
          tokensEstimated: r.tokensEstimated, reasoningTokens: r.reasoningTokens,
        });
      } else {
        stage.emit("interpret:error", { lane: "rival", reason: r.reason, status: r.status });
      }
    });
  }

  const r = await c;
  if (seq !== runSeq) return;
  if (r.ok) {
    turns++;
    stage.emit("interpret:done", {
      lane: "cerebras", text: r.text, queueMs: r.queueMs, decodeMs: r.decodeMs,
      tokens: r.tokens, tps: r.tps, replay: false,
      tokensEstimated: r.tokensEstimated, reasoningTokens: r.reasoningTokens,
    });
    stage.set("done");
    if (cfg.record && cap.source === "clip" && turns === 1 && r.text.trim()) {
      fetch("api/dev/replay", {
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
      const res = await fetch("replays/" + cap.clip.replace(/\.wav$/, "") + ".json");
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
  // sample clips keep the original tracker: their recorded replays quote its numbers
  const features = analyzeBuffer(cap.buffer, { pinned: cap.source === "clip" });
  cap.features = features;
  stage.emit("analysis", { features, buffer: cap.buffer });
  if (features.f0Median === 0) {
    stage.set("error", { reason: cap.source === "file" ? "unvoiced-file" : "unvoiced" });
    return;
  }
  if (cap.window) {
    const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const li = document.createElement("li");
    li.textContent = `used ${mm(cap.window.fromSec)}-${mm(cap.window.toSec)} of ${mm(cap.window.totalSec)}, the loudest part`;
    logList.appendChild(li);
  }
  if (cap.kind === "video") {
    const rms = features.track?.rms || [];
    const hop = features.track?.hopMs || 20;
    // loudest frame inside a call; background noise can be louder than the animal
    const f0 = features.track?.f0 || [];
    const inCall = f0.some((v) => v > 0);
    let peak = -1;
    for (let i = 0; i < rms.length; i++) if ((!inCall || f0[i] > 0) && (peak < 0 || rms[i] > rms[peak])) peak = i;
    if (peak < 0) peak = 0;
    const tMs = peak * hop;
    const dataUrl = await grabVideoFrame(cap.file, cap.window?.fromSec || 0, tMs);
    const sent = dataUrl != null && !cfg.demo && cfg.vision !== false;
    if (dataUrl) { cap.image = dataUrl; cap.imageKind = "moment"; }
    stage.emit("media:frame", { dataUrl, tMs, fromSec: cap.window?.fromSec || 0, sent, demo: !!cfg.demo });
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
  if (cfg.demo) {
    stage.emit("vocalize:error", { reason: "demo" });
    return;
  }
  const r = await vocalize({ text, species: stage.species, sessionId, pet });
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
stage.on("species", (d) => {
  endSession();
  clearMedia();
  pet = localStorage.getItem(`babble.pet.${d.species}`) || d.species;
});
stage.on("intent:media-clear", () => clearMedia());
stage.on("intent:pet", (d) => {
  endSession();
  const name = String(d.name || "").toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 32) || stage.species;
  localStorage.setItem(`babble.pet.${stage.species}`, name);
  pet = name;
});
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
