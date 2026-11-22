// Smoke test for Dev D modules with stubbed DOM.
const absorb = () => {};
const listeners = new Map();
const stage = {
  state: "boot", species: "cat",
  set(s) { this.state = s; this.emit("state", { state: s, prev: "x" }); },
  setSpecies(id) { this.species = id; this.emit("species", { species: id }); },
  on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
  emit(type, detail = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(detail); },
};

function makeEl(tag = "div") {
  const el = {
    tag, children: [], style: { setProperty: absorb }, dataset: {},
    hidden: false, value: "", disabled: false, textContent: "",
    _attrs: {},
    set className(v) { this._cls = v; }, get className() { return this._cls || ""; },
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); },
    addEventListener: absorb, removeEventListener: absorb,
    getBoundingClientRect: () => ({ width: 800, height: 300, left: 0, top: 0, top2: 0 }),
    querySelector: () => null, querySelectorAll: () => [],
    focus: absorb, click() { if (this.onclick) this.onclick(); },
    clientWidth: 800,
    animate: () => ({ finished: Promise.resolve() }),
  };
  Object.defineProperty(el, "textContent", {
    get() { return this._text || ""; },
    set(v) { this._text = v; if (v === "") this.children = []; },
  });
  return el;
}

const anims = [];
global.matchMedia = () => ({ matches: false });
global.requestAnimationFrame = (cb) => 1;
global.cancelAnimationFrame = absorb;
global.addEventListener = absorb;
global.removeEventListener = absorb;
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
global.document = {
  fonts: { ready: Promise.resolve() },
  createElement(tag) {
    if (tag === "span" || tag === "div" || tag === "p" || tag === "button" || tag === "ul" || tag === "li" || tag === "input") return makeEl(tag);
    return makeEl(tag);
  },
  createElementNS: () => makeEl("svg"),
  body: makeEl("body"),
};
global.getComputedStyle = () => ({ fontSize: "16", getPropertyValue: () => "" });
global.performance = global.performance ?? { now: () => Date.now() };
global.window = global;
global.AudioContext = class { resume() { return Promise.resolve(); } get state() { return "running"; } };
Object.defineProperty(global, "navigator", { value: { mediaDevices: {} }, configurable: true });

// capture element.animate calls
function patchAnimate(el) {
  el.animate = (frames, opts) => { anims.push({ frames, opts }); return { finished: Promise.resolve() }; };
  for (const c of el.children) patchAnimate(c);
}

// ---- captions.js ----
const captions = await import("../../babble-d/public/captions.js");
const capEl = makeEl("section");
captions.mount(capEl, stage);
// patch animate on every element the lane created (walk the tree)
(function walk(el) {
  el.animate = (frames, opts) => { anims.push({ frames, opts }); return { finished: Promise.resolve() }; };
  for (const c of el.children) walk(c);
})(capEl);
// and keep patching as new elements appear
const origAppend = capEl.appendChild.bind(capEl);

// idle prompt
stage.set("idle");
// listening -> queued with rotation
stage.set("listening");
stage.emit("analysis", { features: { envelope: [0.1, 0.5, 0.9, 0.3, 0.7], contour: new Array(24).fill(0.5) } });
stage.set("queued");
stage.emit("interpret:start", { lane: "cerebras", t0: performance.now() });
stage.emit("interpret:header", { lane: "cerebras", vocal: "solicitation", mood: "impatient", confidence: 0.82 });
// deltas
const text = "The bowl has been visibly empty for eleven minutes. I am not angry.";
let sent = 0;
for (const chunk of text.match(/.{1,4}/gs)) {
  stage.emit("interpret:delta", { lane: "cerebras", text: chunk, t: performance.now(), first: sent === 0, tps: 40 });
  sent += chunk.length;
}
stage.emit("interpret:done", { lane: "cerebras", text, queueMs: 1200, decodeMs: 800, tokens: 20, tps: 40, replay: false });
stage.set("done");
if (anims.length < 10) throw new Error("expected bar animations, got " + anims.length);
console.log("captions: " + anims.length + " bar/letter animations scheduled");
// count them again after deltas ran (bars animate on schedule())
const animsAfterDeltas = anims.length;

// reply + gloss
stage.emit("reply:sent", { text: "dinner is in ten minutes" });
stage.emit("vocalize:play", { schedule: [{ tMs: 0, type: "meow", gloss: "dinner" }, { tMs: 500, type: "trill", gloss: "soon" }] });

// error + retry
stage.set("error");
stage.emit("interpret:error", { lane: "cerebras", reason: "timeout", status: null });

// race: two lanes, winner, margin, groq offline
stage.emit("intent:race", { on: true });
stage.set("queued");
stage.emit("interpret:start", { lane: "cerebras", t0: performance.now() });
stage.emit("interpret:start", { lane: "groq", t0: performance.now() });
stage.emit("interpret:delta", { lane: "groq", text: "Someone is at the door!" });
stage.emit("interpret:done", { lane: "groq", text: "Someone is at the door!", replay: false });
stage.emit("interpret:delta", { lane: "cerebras", text: "Hello. Hello. Hello." });
stage.emit("interpret:done", { lane: "cerebras", text: "Hello. Hello. Hello.", replay: false });
stage.set("done");
stage.emit("interpret:error", { lane: "groq", reason: "http", status: 501 });
stage.emit("intent:race", { on: false });
console.log("captions: race lanes + winner + offline OK");

// ---- start.js ----
const start = await import("../../babble-d/public/start.js");
const startEl = makeEl("div");
start.mount(startEl, stage);
await new Promise((r) => setTimeout(r, 20));
if (!startEl.children.length) throw new Error("start screen missing");
stage.emit("intent:start", {});
console.log("start: dialog mounted, unlock called via intent");

// ---- controls.js ----
const controls = await import("../../babble-d/public/controls.js");
const ctlEl = makeEl("nav");
// sfx import needs audio.js; stub it via import map? simpler: controls imports sfx which imports audio+stage. audio module runs fine headless? It references window.AudioContext at getCtx only. setMuted is a plain function. OK.
controls.mount(ctlEl, stage);
stage.set("listening");
stage.emit("capture:start", { durationMs: 3000, startedAt: performance.now() });
stage.set("done");
stage.emit("species", { species: "dog" });
console.log("controls: mounted, state/species routes fired");

console.log("ALL D SMOKE TESTS PASS");
