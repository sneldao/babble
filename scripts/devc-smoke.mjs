// Smoke test for Dev C modules with stubbed DOM/canvas/audio.
// Exercises mount() logic and the frame loop without a browser.
const calls = { log: [] };
const absorb = () => {};
const proxy = new Proxy(function(){}, {
  get: (t, k) => {
    if (k === Symbol.toPrimitive) return () => 0;
    return proxy;
  },
  apply: () => proxy,
  set: () => true,
});

const ctx2d = new Proxy({}, {
  get: (t, k) => {
    if (k === "createRadialGradient" || k === "createLinearGradient")
      return () => ({ addColorStop: absorb });
    if (k === "measureText") return () => ({ width: 10 });
    return typeof k === "string" ? ((k === "canvas") ? {} : proxy) : proxy;
  },
  set: () => true,
});

const listeners = new Map();
const stage = {
  state: "idle", species: "cat",
  set(s) { this.state = s; this.emit("state", { state: s, prev: "x" }); },
  setSpecies(id) { this.species = id; this.emit("species", { species: id }); },
  on(type, fn) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); return () => listeners.get(type).delete(fn); },
  emit(type, detail = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(detail); },
};

const el = {
  children: [],
  innerHTML: "",
  appendChild(c) { this.children.push(c); },
  getBoundingClientRect: () => ({ width: 400, height: 300, left: 0, top: 0 }),
};
function makeCanvas() {
  return {
    style: {}, width: 0, height: 0,
    getContext: () => ctx2d,
    setAttribute: absorb,
  };
}

let rafCbs = [];
global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length; };
global.cancelAnimationFrame = absorb;
global.ResizeObserver = class { observe() {} disconnect() {} };
global.matchMedia = () => ({ matches: false });
global.addEventListener = absorb;
global.removeEventListener = absorb;
global.getComputedStyle = () => ({ getPropertyValue: () => "#e4572e" });
global.devicePixelRatio = 2;
global.performance = global.performance ?? { now: () => Date.now() };
global.document = {
  body: { dataset: {} },
  createElement(tag) {
    if (tag === "canvas") return makeCanvas();
    return { style: {}, appendChild: absorb, addEventListener: absorb, setAttribute: absorb, classList: { add: absorb, toggle: absorb } };
  },
};
global.window = global;
global.AudioContext = class {
  constructor() { this.state = "running"; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; }
  resume() { return Promise.resolve(); }
  createGain() { const n = { gain: { value: 0, setValueAtTime: absorb, linearRampToValueAtTime: absorb, exponentialRampToValueAtTime: absorb, setTargetAtTime: absorb }, connect: () => n, disconnect: absorb }; return n; }
  createDynamicsCompressor() { const n = this.createGain(); ["threshold","knee","ratio","attack","release"].forEach(k => n[k] = { value: 0 }); return n; }
  createConvolver() { const n = this.createGain(); n.buffer = null; return n; }
  createAnalyser() { const n = this.createGain(); n.fftSize = 0; n.getByteTimeDomainData = (a) => a.fill(128); return n; }
  createBiquadFilter() { const n = this.createGain(); n.frequency = { value: 0, setValueAtTime: absorb, exponentialRampToValueAtTime: absorb }; n.Q = { value: 0 }; n.type = ""; return n; }
  createOscillator() { const n = this.createGain(); n.frequency = { value: 0, setValueAtTime: absorb, exponentialRampToValueAtTime: absorb }; n.detune = { value: 0, setValueAtTime: absorb, linearRampToValueAtTime: absorb }; n.type = ""; n.start = absorb; n.stop = absorb; n.onended = null; return n; }
  createBufferSource() { const n = this.createGain(); n.buffer = null; n.loop = false; n.start = absorb; n.stop = absorb; n.connect = () => n; return n; }
  createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) }; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
};

// ---- audio.js ----
const audio = await import("../public/audio.js");
audio.unlock();
const out1 = audio.getOut(), out2 = audio.getFxOut();
if (!out1 || !out2) throw new Error("audio bus missing");
const pb = audio.playBuffer({ duration: 1 });
if (!pb.analyser) throw new Error("playBuffer returned no analyser");
console.log("audio.js OK: bus built, playBuffer returns analyser");

// ---- synth.js ----
const synth = await import("../public/synth.js");
const script = [
  { type: "meow", shape: "arch", dur: 0.5, pitch: 520, intensity: 0.7, gloss: "dinner" },
  { type: "bark", shape: "rising", dur: 0.2, pitch: 300, intensity: 0.8 },
  { type: "hiss", shape: "falling", dur: 0.4, pitch: 800, intensity: 0.5 },
  { type: "meow", shape: "warble", dur: 0.6, pitch: 500, intensity: 0.6 }, // long: gets vibrato
];
const r = synth.playScript(script);
if (!r.schedule || r.schedule.length !== 4) throw new Error("schedule length wrong");
for (const [i, e] of r.schedule.entries()) {
  for (const k of ["tMs", "durMs", "type", "shape", "pitch", "gloss"]) if (!(k in e)) throw new Error("schedule entry missing " + k);
  if (i > 0 && e.tMs <= r.schedule[i - 1].tMs) throw new Error("schedule not monotonic");
}
if (r.totalMs <= 0) throw new Error("totalMs wrong");
console.log("synth.js OK: playScript ->", JSON.stringify({ startedAt: r.startedAt > 0, totalMs: Math.round(r.totalMs), entries: r.schedule.length }));

// ---- sfx.js ----
const sfx = await import("../public/sfx.js");
const teardownSfx = sfx.mount(el, stage);
sfx.setMuted(true);
stage.emit("capture:start", {});
sfx.setMuted(false);
stage.emit("intent:start", {});
stage.emit("analysis", {});
stage.emit("species", { species: "dog" });
stage.emit("interpret:error", {});
console.log("sfx.js OK: all stage routes fired without throwing");

// ---- character.js ----
const character = await import("../public/character.js");
const teardown = character.mount(el, stage);
// pump the frame loop
for (let i = 0; i < 120; i++) {
  const cbs = rafCbs; rafCbs = [];
  for (const cb of cbs) cb(performance.now() + i * 16);
}
// drive the full event table
stage.set("listening");
stage.emit("capture:start", { analyser: null });
stage.set("queued");
stage.emit("interpret:header", { vocal: "solicitation", confidence: 0.8 });
await new Promise((r2) => setTimeout(r2, 500)); // surprised->happy timer
stage.emit("interpret:delta", { text: "x" });
stage.emit("interpret:done", {});
stage.emit("interpret:error", {});
stage.set("idle");
for (const v of ["protest", "distress", "alarm", "greeting", "play", "contentment", "unknown-thing"]) {
  stage.emit("interpret:header", { vocal: v, confidence: null });
}
stage.setSpecies("dog");
stage.setSpecies("infant");
stage.setSpecies("cat");
stage.emit("vocalize:play", { schedule: [{ tMs: 0 }, { tMs: 300 }], startedAt: performance.now(), totalMs: 600 });
for (let i = 0; i < 120; i++) {
  const cbs = rafCbs; rafCbs = [];
  for (const cb of cbs) cb(performance.now() + 1000 + i * 16);
}
teardown();
teardownSfx();
console.log("character.js OK: full event table + 240 frames + species swaps, no throws");
console.log("ALL SMOKE TESTS PASS");
