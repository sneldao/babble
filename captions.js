// Streaming captions — Dev D (docs/redesign/dev-d-captions.md).
// Ported from codrops/TextCharacterAnimations `js/variations/voiceNote.js`
// (MIT, Codrops): a bar per letter that grows on arrival, flickers like a
// level meter while it waits, then shrinks into its centre as the letter
// fades in a few characters behind the front. Ported to CSS transitions +
// rAF scheduling; bar heights come from the capture's loudness envelope.
// Row roll-up follows `js/variations/liveCaptions.js` (same source).

import { SPECIES } from "./stage.js";

const LAG_MS = 175;        // 5 chars at 35 ms/char (voiceNote settings.lag)
const MAX_BEHIND_MS = 400; // text never more than this behind the stream
const BAR_MIN = 0.2, BAR_MAX = 0.8;

const QUEUE_LINES = {
  cat: [
    "Composing a complaint.",
    "Evaluating your effort so far.",
    "The bowl. It is empty.",
    "You knew what this was.",
    "Preparing the charge sheet.",
    "Impatience, but eloquent.",
  ],
  dog: [
    "Too excited to form words.",
    "So many smells to report.",
    "Best day ever. Again.",
    "Translating pure enthusiasm.",
    "Bark first, words after.",
    "Almost a sentence—wait, squirrel.",
  ],
  infant: [
    "Gathering breath.",
    "Needs. All of them.",
    "Louder means clearer, right?",
    "Warming up the small voice.",
    "One want, repeated.",
    "Practising the important word.",
  ],
};

const ERROR_TEXT = {
  timeout: "No answer after 12 seconds. The model's queue is full.",
  network: "Lost the connection.",
  unvoiced: "Nothing voiced in that capture. Try closer to the mic.",
  internal: "Something broke on our side.",
};
const errorText = (reason, status, message) => {
  if (reason === "http") return `The interpreter returned an error (status ${status ?? "?"}).`;
  if (reason === "mic") return `Microphone unavailable. ${message || ""}`.trim();
  return ERROR_TEXT[reason] || "Something broke on our side.";
};

const LANE_NAME = { cerebras: "Kimi K3.1 Pro on Cerebras", groq: "Groq" };

export function mount(el, st) {
  el.innerHTML = "";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const lanesEl = document.createElement("div");
  lanesEl.className = "cap-lanes";
  const replyEl = document.createElement("div");
  replyEl.className = "cap-reply";
  const liveEl = document.createElement("p");
  liveEl.className = "visually-hidden";
  liveEl.setAttribute("aria-live", "polite");
  el.append(lanesEl, replyEl, liveEl);

  let envelope = null;
  let envMax = 0;
  let lastReplyText = "";
  let glossTimers = [];

  function barHeight(i, N) {
    if (!envelope || !envMax) return 0.5;
    const denom = Math.max(N, 60);
    const pos = Math.min(1, i / denom) * (envelope.length - 1);
    const a = Math.floor(pos), f = pos - a;
    const v = (envelope[a] || 0) + ((envelope[a + 1] ?? envelope[a]) || 0) * f;
    return BAR_MIN + (BAR_MAX - BAR_MIN) * Math.min(1, Math.max(0, v / envMax));
  }

  function makeLane(name) {
    const lane = document.createElement("div");
    lane.className = "cap-lane";
    lane.dataset.lane = name;
    lane.setAttribute("aria-hidden", "true");

    const head = document.createElement("div");
    head.className = "cap-head";
    const label = document.createElement("div");
    label.className = "cap-label";
    const nameEl = document.createElement("span");
    nameEl.textContent = LANE_NAME[name];
    const tag = document.createElement("span");
    tag.className = "cap-tag";
    tag.textContent = "REPLAY · recorded response";
    tag.hidden = true;
    const flag = document.createElement("span");
    flag.className = "cap-flag";
    label.append(nameEl, tag, flag);

    const notice = document.createElement("div");
    notice.className = "cap-status cap-notice";
    notice.hidden = true;

    const utt = document.createElement("div");
    utt.className = "cap-utt";
    const uttIn = document.createElement("div");
    uttIn.className = "cap-utt-in";
    utt.appendChild(uttIn);

    const status = document.createElement("div");
    status.className = "cap-status";
    lane.append(notice, head, label, utt, status);
    lanesEl.appendChild(lane);

    const L = {
      name, el: lane, head, tag, flag, notice, utt, uttIn, status,
      text: "", chars: [], pending: [], raf: 0, doneMs: null, startT0: 0,
      queueTimer: 0, queueIdx: 0,
    };
    return L;
  }

  const lanes = { cerebras: makeLane("cerebras"), groq: makeLane("groq") };
  lanes.groq.el.hidden = true;
  new ResizeObserver(() => requestAnimationFrame(() => {
    fitLane(lanes.cerebras); fitLane(lanes.groq);
  })).observe(lanesEl);

  function stopQueue(L) {
    clearInterval(L.queueTimer);
    L.queueTimer = 0;
  }

  function clearLane(L, keepHeader = false) {
    stopQueue(L);
    if (L.raf) cancelAnimationFrame(L.raf);
    L.raf = 0;
    L.text = "";
    L.chars = [];
    L.pending = [];
    L.doneMs = null;
    L.uttIn.textContent = "";
    L.status.textContent = "";
    L.notice.hidden = true;
    if (!keepHeader) {
      L.el.classList.remove("has-header");
      L.head.textContent = "";
      L.tag.hidden = true;
      L.flag.textContent = "";
    }
  }

  function setPrompt() {
    clearLane(lanes.cerebras);
    clearLane(lanes.groq);
    const p = document.createElement("span");
    p.className = "cap-prompt";
    p.textContent = "Listen to a sound, or try a sample.";
    lanes.cerebras.uttIn.appendChild(p);
    replyEl.textContent = "";
    for (const t of glossTimers) clearTimeout(t);
    glossTimers = [];
  }

  function showBreathing(L) {
    clearLane(L);
    const b = document.createElement("div");
    b.className = "cap-breathe";
    for (let i = 0; i < 18; i++) b.appendChild(document.createElement("i"));
    L.uttIn.appendChild(b);
  }

  function startQueue(L, t0) {
    stopQueue(L);
    L.startT0 = t0 || performance.now();
    const lines = QUEUE_LINES[st.species] || QUEUE_LINES.cat;
    L.queueIdx = 0;
    const render = () => {
      const el2 = Math.floor((performance.now() - L.startT0) / 100) / 10;
      L.status.textContent = "";
      const line = document.createElement("span");
      line.className = "cap-line swap-in";
      line.textContent = lines[L.queueIdx % lines.length];
      const cnt = document.createElement("span");
      cnt.className = "cap-elapsed";
      cnt.textContent = ` · ${el2.toFixed(1)} s`;
      L.status.append(line, cnt);
    };
    render();
    let lastLine = -1;
    L.queueTimer = setInterval(() => {
      const idx = Math.floor((performance.now() - L.startT0) / 2500);
      if (idx !== lastLine) { lastLine = idx; L.queueIdx = idx; render(); }
      else {
        const cnt = L.status.querySelector(".cap-elapsed");
        if (cnt) cnt.textContent = ` · ${(Math.floor((performance.now() - L.startT0) / 100) / 10).toFixed(1)} s`;
      }
    }, 100);
  }

  // --- character append + reveal scheduling -------------------------------

  function appendChars(L, text) {
    for (const chunk of text.split(/(\s+)/)) {
      if (!chunk) continue;
      if (/^\s+$/.test(chunk)) {
        for (const c of chunk) {
          const sp = document.createElement("span");
          sp.className = "cap-word";
          sp.textContent = c;
          L.uttIn.appendChild(sp);
          L.text += c;
        }
        continue;
      }
      const word = document.createElement("span");
      word.className = "cap-word";
      for (const c of chunk) {
        const idx = L.text.length;
        L.text += c;
        if (RM) {
          const ch = document.createElement("span");
          ch.className = "cap-ch on";
          ch.textContent = c;
          word.appendChild(ch);
          continue;
        }
        const ch = document.createElement("span");
        ch.className = "cap-ch";
        ch.textContent = c;
        const bar = document.createElement("i");
        bar.className = "cap-bar";
        bar.style.height = barHeight(idx, L.text.length).toFixed(2) + "em";
        ch.appendChild(bar);
        word.appendChild(ch);
        const rec = { ch, bar, arrived: performance.now(), revealed: false };
        L.chars.push(rec);
        L.pending.push(rec);
        requestAnimationFrame(() => { bar.classList.add("grown"); });
        setTimeout(() => { if (!rec.revealed) bar.classList.add("flick"); }, 110);
      }
      L.uttIn.appendChild(word);
    }
    fitLane(L);
    if (!RM) scheduleReveal(L);
  }

  function fitLane(L) {
    L.utt.classList.toggle("roll", L.uttIn.scrollHeight > L.utt.clientHeight + 2);
  }

  function scheduleReveal(L) {
    if (L.raf) return;
    const tick = () => {
      L.raf = 0;
      const now = performance.now();
      while (L.pending.length) {
        const rec = L.pending[0];
        const age = now - rec.arrived;
        // Normal lag 175 ms, hard cap 400 ms behind the arrival.
        const due = rec.arrived + LAG_MS;
        const must = age >= MAX_BEHIND_MS - 60;
        if (now < due && !must) break;
        reveal(rec, age > 300);
        L.pending.shift();
      }
      if (L.pending.length) L.raf = requestAnimationFrame(tick);
    };
    L.raf = requestAnimationFrame(tick);
  }

  function reveal(rec, fast) {
    if (rec.revealed) return;
    rec.revealed = true;
    rec.bar.classList.remove("flick");
    if (fast) {
      rec.bar.classList.add("blip", "done");
      rec.ch.classList.add("on");
      setTimeout(() => rec.bar.remove(), 80);
    } else {
      rec.bar.classList.remove("grown");
      rec.bar.classList.add("done");
      rec.ch.classList.add("on");
      setTimeout(() => rec.bar.remove(), 200);
    }
  }

  function finishPending(L) {
    for (const rec of L.pending.splice(0)) reveal(rec, true);
    if (L.raf) cancelAnimationFrame(L.raf);
    L.raf = 0;
    // Anything left dim (a record lost to a cleared queue, a delta that
    // raced the done) still ends fully opaque.
    for (const ch of L.uttIn.querySelectorAll(".cap-ch:not(.on)")) ch.classList.add("on");
    for (const bar of L.uttIn.querySelectorAll(".cap-bar")) bar.remove();
  }

  // --- header + race -------------------------------------------------------

  let raceOn = false;
  let doneTimes = {};

  function confBlocks(conf) {
    let s = "";
    for (let i = 0; i < 5; i++) s += conf >= (i + 0.5) / 5 ? "▮" : "▯";
    return s;
  }

  function onHeader(d) {
    const L = lanes[d.lane];
    if (!L) return;
    stopQueue(L);
    L.status.textContent = "";
    L.el.classList.add("has-header");
    const parts = [];
    if (d.vocal) parts.push(String(d.vocal).toUpperCase());
    if (d.mood) parts.push(String(d.mood));
    if (d.confidence != null) parts.push(`${confBlocks(d.confidence)} ${Math.round(d.confidence * 100)}%`);
    L.head.textContent = parts.join(" · ");
  }

  function onDone(d) {
    const L = lanes[d.lane];
    if (!L) return;
    finishPending(L);
    L.doneMs = performance.now();
    if (d.replay) L.tag.hidden = false;
    fitLane(L);
    if (d.lane === "cerebras") {
      liveEl.textContent = d.text || "";
      replyEl.textContent = ""; // new result supersedes an old reply line
    }
    if (raceOn && d.lane !== undefined) {
      doneTimes[d.lane] = { t: performance.now(), t0: L.startT0 || performance.now() };
      const first = Object.entries(doneTimes).sort((a, b) => a[1].t - b[1].t)[0];
      if (first) {
        const secs = ((first[1].t - first[1].t0) / 1000).toFixed(2);
        lanes[first[0]].flag.textContent = `finished first · ${secs} s`;
      }
      if (doneTimes.cerebras && doneTimes.groq) {
        const margin = (Math.abs(doneTimes.cerebras.t - doneTimes.groq.t) / 1000).toFixed(2);
        lanes.cerebras.flag.textContent += ` · margin ${margin} s`;
      }
    }
  }

  function onError(d) {
    const L = lanes[d.lane];
    if (!L) return;
    finishPending(L);
    stopQueue(L);
    if (d.lane === "groq" && d.status === 501) {
      L.status.textContent = "";
      const e = document.createElement("span");
      e.className = "cap-error";
      e.textContent = "Groq offline (no key)";
      L.status.appendChild(e);
      return;
    }
  }

  // --- stage wiring --------------------------------------------------------

  const unsubs = [
    st.on("analysis", (d) => {
      envelope = d.features?.envelope || null;
      envMax = envelope ? Math.max(...envelope) || 0 : 0;
    }),
    st.on("state", (d) => {
      if (d.state === "idle") setPrompt();
      if (d.state === "listening" || d.state === "analysing") {
        doneTimes = {};
        showBreathing(lanes.cerebras);
        if (raceOn) showBreathing(lanes.groq);
      }
      if (d.state === "error") {
        const L = lanes.cerebras;
        stopQueue(L);
        L.status.textContent = "";
        const e = document.createElement("span");
        e.className = "cap-error";
        e.textContent = errorText(d.reason, d.status, d.message);
        L.status.appendChild(e);
        if (d.retry) {
          const b = document.createElement("button");
          b.className = "cap-retry";
          b.type = "button";
          b.textContent = "Retry";
          b.addEventListener("click", () => st.emit("intent:retry"));
          L.status.appendChild(b);
        }
      }
    }),
    st.on("interpret:start", (d) => {
      const L = lanes[d.lane];
      if (!L) return;
      if (d.lane === "groq" && !raceOn) {
        raceOn = true;
        el.dataset.race = "on";
        lanes.groq.el.hidden = false;
      }
      clearLane(L);
      startQueue(L, d.t0);
    }),
    st.on("intent:race", (d) => {
      raceOn = !!d.on;
      el.dataset.race = raceOn ? "on" : "off";
      lanes.groq.el.hidden = !raceOn;
      if (!raceOn) clearLane(lanes.groq);
    }),
    st.on("interpret:header", onHeader),
    st.on("interpret:delta", (d) => {
      const L = lanes[d.lane];
      if (!L) return;
      stopQueue(L);
      L.status.textContent = "";
      appendChars(L, d.text || "");
    }),
    st.on("interpret:error", (d) => {
      onError(d);
      if (d.lane === "cerebras" && d.reason) {
        // a replay may follow; note it if the stream later recovers
        lanes.cerebras.notice.textContent = "";
        lanes.cerebras.notice.hidden = true;
      }
    }),
    st.on("interpret:done", onDone),
    st.on("reply:sent", (d) => {
      lastReplyText = d.text;
      replyEl.textContent = "";
      const you = document.createElement("div");
      you.className = "you";
      const b = document.createElement("b");
      b.textContent = "you";
      you.append(b, document.createTextNode(d.text));
      replyEl.appendChild(you);
    }),
    st.on("vocalize:play", (d) => {
      const g = document.createElement("div");
      g.className = "cap-glosses";
      const parts = (d.schedule || []).filter((s) => s.gloss);
      parts.forEach((s, i) => {
        const sp = document.createElement("span");
        sp.textContent = (i ? " · " : "") + `${s.type || ""} (${s.gloss})`;
        g.appendChild(sp);
        glossTimers.push(setTimeout(() => sp.classList.add("on"), s.tMs));
      });
      replyEl.appendChild(g);
    }),
    st.on("vocalize:error", () => {
      const g = document.createElement("div");
      g.className = "cap-glosses";
      const e = document.createElement("span");
      e.className = "cap-error on";
      e.textContent = "Couldn't vocalize that.";
      const b = document.createElement("button");
      b.className = "cap-retry";
      b.type = "button";
      b.textContent = "Retry";
      b.addEventListener("click", () => st.emit("intent:reply", { text: lastReplyText }));
      g.append(e, b);
      replyEl.appendChild(g);
    }),
  ];

  // "Live model timed out; showing a recorded response." — shown when an
  // interpret:error precedes replay deltas (detected via replay tag on done).
  st.on("interpret:delta", (d) => {
    if (d.lane !== "cerebras") return;
    if (lanes.cerebras._hadError) {
      lanes.cerebras.notice.textContent = "Live model timed out; showing a recorded response.";
      lanes.cerebras.notice.hidden = false;
      lanes.cerebras._hadError = false;
    }
  });
  unsubs.push(st.on("interpret:error", (d) => {
    if (d.lane === "cerebras") lanes.cerebras._hadError = true;
  }));
  unsubs.push(st.on("capture:start", () => { lanes.cerebras._hadError = false; }));

  if (st.state === "boot" || st.state === "idle") setPrompt();
  return () => unsubs.forEach((u) => u());
}
