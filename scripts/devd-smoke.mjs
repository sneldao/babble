// Smoke test for the Dev D modules in THIS repo with a stubbed DOM.
// Assertions are on outcomes (DOM contents), not animation internals.
const absorb = () => {};
const listeners = new Map();
const stage = {
  state: "boot", species: "cat",
  set(s) { this.state = s; this.emit("state", { state: s, prev: "x" }); },
  setSpecies(id) { this.species = id; this.emit("species", { species: id }); },
  on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
  emit(type, detail = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(detail); },
};

function classListOf(el) {
  const set = new Set((el._cls || "").split(/\s+/).filter(Boolean));
  return {
    add: (...c) => c.forEach((k) => set.add(k)),
    remove: (...c) => c.forEach((k) => set.delete(k)),
    toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; on ? set.add(c) : set.delete(c); return on; },
    contains: (c) => set.has(c),
  };
}

function makeEl(tag = "div") {
  const el = {
    tag, children: [], dataset: {}, _attrs: {},
    hidden: false, value: "", disabled: false, type: "", size: 0,
    clientWidth: 800, clientHeight: 300, scrollHeight: 100,
    set className(v) { this._cls = v; this._cl = classListOf(this); },
    get className() { return this._cls || ""; },
    get classList() { return this._cl || (this._cl = classListOf(this)); },
    get firstChild() { return this.children[0] ?? null; },
    get lastChild() { return this.children[this.children.length - 1] ?? null; },
    get childNodes() { return this.children; },
    get innerHTML() { return ""; },
    set innerHTML(v) { if (v === "") this.children = []; },
    style: { setProperty: absorb, removeProperty: absorb },
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    insertBefore(c, ref) {
      const i = ref ? this.children.indexOf(ref) : -1;
      this.children.splice(i < 0 ? this.children.length : i, 0, c);
      c.parentElement = this; return c;
    },
    prepend(...cs) { for (const c of [...cs].reverse()) this.children.unshift(c), c.parentElement = this; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); },
    addEventListener(t, f) { (this._ls ||= {})[t] = f; }, removeEventListener(t) { delete this._ls?.[t]; },
    getBoundingClientRect: () => ({ width: 800, height: 300, left: 0, top: 0, right: 800, bottom: 300 }),
    querySelector: () => null, querySelectorAll: () => [],
    focus: absorb, click() { if (this.onclick) this.onclick(); },
    animate: () => ({ finished: Promise.resolve() }),
    getContext: () => new Proxy({}, { get: (t, p) => t[p] ?? (() => fakeCtxValue()) }),
    cloneNode(deep) {
      const c = makeEl(this.tag);
      c._cls = this._cls; c._text = this._text; c.hidden = this.hidden;
      Object.assign(c._attrs, this._attrs || {});
      if (deep) for (const ch of this.children || []) c.appendChild(ch.cloneNode ? ch.cloneNode(true) : { ...ch });
      return c;
    },
  };
  Object.defineProperty(el, "textContent", {
    get() { return this._text !== undefined ? this._text : this.children.map((c) => c.textContent || "").join(""); },
    set(v) { this._text = v; if (v === "") this.children = []; },
  });
  return el;
}
function fakeCtxValue() { return { width: 0 }; }

global.matchMedia = () => ({ matches: false, addEventListener: absorb });
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = absorb;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
global.addEventListener = absorb;
global.removeEventListener = absorb;
global.devicePixelRatio = 1;
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
global.document = {
  fonts: { ready: Promise.resolve() },
  documentElement: makeEl("html"),
  body: makeEl("body"),
  createElement: (tag) => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag),
  createTextNode: (t) => ({ textContent: String(t), children: [] }),
  addEventListener(t, f) { (this._ls ||= {})[t] = f; }, removeEventListener(t) { delete this._ls?.[t]; },
  activeElement: null,
};
global.getComputedStyle = () => ({ fontSize: "16px", getPropertyValue: () => "" });
global.window = global;
const store = new Map();
global.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.AudioContext = class { resume() { return Promise.resolve(); } get state() { return "running"; } };
Object.defineProperty(global, "navigator", { value: { mediaDevices: {} }, configurable: true });

function* walk(el) {
  yield el;
  for (const c of el.children || []) yield* walk(c);
}
const find = (root, pred) => [...walk(root)].filter(pred);
const hasCls = (cls) => (e) => e.classList && e.classList.contains(cls);
const fail = (m) => { throw new Error(m); };

// ---- captions.js ----
const captions = await import("../public/captions.js");
const capEl = makeEl("section");
captions.mount(capEl, stage);

stage.set("idle");
stage.set("listening");
stage.emit("analysis", { features: { envelope: [0.1, 0.5, 0.9, 0.3, 0.7], contour: new Array(24).fill(0.5) } });
stage.set("queued");
stage.emit("interpret:start", { lane: "cerebras", t0: performance.now() });
stage.emit("interpret:header", { lane: "cerebras", vocal: "solicitation", mood: "impatient", confidence: 0.82, evidence: "rising contour; 2 calls; median f0 600 Hz" });
const text = "The bowl has been visibly empty for eleven minutes. I am not angry.";
let sent = 0;
for (const chunk of text.match(/.{1,4}/gs)) {
  stage.emit("interpret:delta", { lane: "cerebras", text: chunk, t: performance.now(), first: sent === 0, tps: 40 });
  sent += chunk.length;
}
stage.emit("interpret:done", { lane: "cerebras", text, queueMs: 1200, decodeMs: 800, tokens: 20, tps: 40, replay: false });
stage.set("done");

const nonSpace = text.replace(/\s+/g, "");
const chars = find(capEl, hasCls("cap-ch"));
if (chars.length !== nonSpace.length) fail(`expected ${nonSpace.length} char spans, got ${chars.length}`);
const joined = chars.map((c) => c.textContent).join("");
if (joined !== nonSpace) fail(`char text mismatch: "${joined}"`);
const dim = chars.filter((c) => !c.classList.contains("on"));
if (dim.length) fail(`${dim.length} chars still not revealed after done`);
const live = find(capEl, hasCls("visually-hidden"))[0];
if (!live || live.textContent !== text + " Heard: rising contour; 2 calls; median f0 600 Hz.") fail(`aria-live text wrong: "${live?.textContent}"`);
const evLine = find(capEl, hasCls("cap-ev"))[0];
if (!evLine || evLine.hidden || !/heard: rising contour/.test(evLine.textContent)) fail(`evidence line wrong: "${evLine?.textContent}"`);
console.log(`captions: ${chars.length} chars, all revealed, aria-live = final text`);

// reply + gloss
stage.emit("reply:sent", { text: "dinner is in ten minutes" });
stage.emit("vocalize:play", { schedule: [{ tMs: 0, type: "meow", gloss: "dinner" }, { tMs: 500, type: "trill", gloss: "soon" }] });
if (!find(capEl, hasCls("you")).length) fail("reply 'you' line missing");
if (!find(capEl, hasCls("cap-glosses")).length) fail("glosses missing");
console.log("captions: reply line + glosses OK");

// error + retry
stage.set("error");
stage.emit("interpret:error", { lane: "cerebras", reason: "timeout", status: null });

// race: two lanes, winner flag, margin, rival 501 offline message
stage.emit("intent:race", { on: true });
stage.set("queued");
stage.emit("interpret:start", { lane: "cerebras", t0: performance.now() });
stage.emit("interpret:start", { lane: "rival", t0: performance.now() });
stage.emit("interpret:delta", { lane: "rival", text: "Someone is at the door!" });
stage.emit("interpret:done", { lane: "rival", text: "Someone is at the door!", replay: false });
stage.emit("interpret:delta", { lane: "cerebras", text: "Hello. Hello. Hello." });
stage.emit("interpret:done", { lane: "cerebras", text: "Hello. Hello. Hello.", replay: false });
stage.set("done");
const lanes = find(capEl, hasCls("cap-lane"));
if (lanes.length !== 2) fail(`expected 2 lanes, got ${lanes.length}`);
const flags = find(capEl, hasCls("cap-flag")).map((f) => f.textContent);
if (!flags.some((t) => /finished first/.test(t))) fail(`winner flag missing: ${JSON.stringify(flags)}`);
if (!flags.some((t) => /margin/.test(t))) fail(`margin missing: ${JSON.stringify(flags)}`);
stage.emit("interpret:error", { lane: "rival", reason: "http", status: 501 });
if (![...walk(capEl)].some((e) => e.textContent === "GPU rival offline (not configured)")) fail("rival offline message missing");
stage.emit("intent:race", { on: false });
console.log("captions: race lanes + winner + margin + rival offline OK");

// ---- start.js ----
const start = await import("../public/start.js");
const startEl = makeEl("div");
start.mount(startEl, stage);
await new Promise((r) => setTimeout(r, 20));
if (!startEl.children.length) fail("start screen mounted nothing");
console.log("start: dialog mounted with " + startEl.children.length + " children");

// ---- controls.js ----
const controls = await import("../public/controls.js");
const ctlEl = makeEl("nav");
controls.mount(ctlEl, stage);
if (!ctlEl.children.length) fail("controls mounted nothing");
// pet name field emits intent:pet on Enter and change
const petIn = find(ctlEl, hasCls("ctl-pet-in"))[0];
if (!petIn) fail("pet name field missing");
let petEvt = null;
stage.on("intent:pet", (d) => { petEvt = d; });
petIn.value = "Miso";
petIn._ls?.keydown?.({ key: "Enter", stopPropagation: absorb });
if (petEvt?.name !== "Miso") fail(`intent:pet not emitted on Enter: ${JSON.stringify(petEvt)}`);
petIn.value = "Pesto";
petEvt = null;
petIn._ls?.change?.({});
if (petEvt?.name !== "Pesto") fail(`intent:pet not emitted on change: ${JSON.stringify(petEvt)}`);
console.log("controls: pet field emits intent:pet");
stage.set("listening");
stage.emit("capture:start", { durationMs: 3000, startedAt: performance.now() });
stage.set("done");
stage.emit("species", { species: "dog" });
console.log("controls: mounted with " + ctlEl.children.length + " children");

console.log("ALL D SMOKE TESTS PASS");
process.exit(0); // queue/reveal intervals are still live; exit explicitly
