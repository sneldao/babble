import { analyzeBuffer, captureMic } from "./acoustics.js";
import { playScript } from "./synth.js";

const $ = (s) => document.querySelector(s);
const SPECIES = {
  cat: { label: "Cat", persona: "aloof, judgemental, affectionate on its own terms", range: "meow ~400-700Hz" },
  dog: { label: "Dog", persona: "unguarded enthusiasm, every feeling at full volume", range: "bark ~250-500Hz" },
  infant: { label: "Infant", persona: "pure need, no subtext", range: "cry ~350-450Hz" },
};
let species = "cat";
let history = [];
let listening = false;
let analyser, animId, camStream, camOn = false;

// ---------- species picker ----------
for (const [id, s] of Object.entries(SPECIES)) {
  const b = document.createElement("button");
  b.className = "species" + (id === species ? " on" : "");
  b.textContent = s.label;
  b.onclick = () => {
    species = id;
    document.querySelectorAll(".species").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    setPersona();
  };
  $("#speciesRow").appendChild(b);
}
function setPersona() {
  $("#persona").textContent = SPECIES[species].persona;
  $("#avatar").dataset.species = species;
}
setPersona();

// ---------- mic level meter ----------
function meterSetup(stream) {
  const c = new AudioContext();
  const src = c.createMediaStreamSource(stream);
  analyser = c.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
}
function meterTick() {
  if (!analyser) return;
  const d = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(d);
  const c = $("#wave");
  const x = c.getContext("2d");
  x.fillStyle = "#0c0d12";
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = "#ff8a5c";
  x.beginPath();
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] / 255) * c.height;
    i ? x.lineTo((i / d.length) * c.width, y) : x.moveTo(0, y);
  }
  x.stroke();
  animId = requestAnimationFrame(meterTick);
}

// ---------- listen ----------
$("#listen").onclick = async () => {
  if (listening) return;
  listening = true;
  $("#listen").classList.add("rec");
  $("#listen").textContent = "listening…";
  const secs = +$("#dur").value;
  try {
    const buf = await captureMic(secs);
    await interpret(buf);
  } catch (e) {
    bubble("system", "mic error: " + e.message);
  }
  $("#listen").classList.remove("rec");
  $("#listen").textContent = "LISTEN";
  listening = false;
};

// ---------- audio file input ----------
$("#file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await f.arrayBuffer());
  await interpret(buf);
};

// ---------- demo clips ----------
$("#democlip").onchange = async (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt?.value) return;
  if (opt.dataset.s && opt.dataset.s !== species) {
    species = opt.dataset.s;
    document.querySelectorAll(".species").forEach((x) => {
      x.classList.toggle("on", x.textContent === SPECIES[species].label);
    });
    setPersona();
  }
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await (await fetch("/clips/" + opt.value)).arrayBuffer());
  // play it so the room hears the original vocalization
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  avatarReact("speak");
  await interpret(buf);
  e.target.value = "";
};

// ---------- webcam ----------
$("#cam").onclick = async () => {
  if (camOn) {
    camStream?.getTracks().forEach((t) => t.stop());
    $("#camView").style.display = "none";
    camOn = false;
    $("#cam").classList.remove("on");
    return;
  }
  camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 480 } });
  const v = $("#camView");
  v.srcObject = camStream;
  v.style.display = "block";
  camOn = true;
  $("#cam").classList.add("on");
};
function grabFrame() {
  if (!camOn) return null;
  const v = $("#camView");
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = Math.round(480 * (v.videoHeight / v.videoWidth || 0.75));
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.6);
}

// ---------- interpret ----------
async function interpret(buf) {
  const features = analyzeBuffer(buf);
  drawSpectrogram(buf);
  drawContour(features);
  if (features.f0Median === 0) {
    bubble("system", "nothing voiced in that capture — try closer to the mic");
    return;
  }
  const card = bubble("animal", "");
  const meta = card.querySelector(".meta");
  const body = card.querySelector(".body");
  meta.textContent = `${species} · ${features.shape} ${features.f0Median}Hz · ${(features.durationMs / 1000).toFixed(1)}s`;

  const t0 = performance.now();
  const queueEl = $("#queue");
  let qi = 0;
  queueEl.style.display = "block";
  const qTick = setInterval(() => {
    qi++;
    queueEl.textContent = `in queue behind other interpreters… ${(qi / 10).toFixed(1)}s`;
  }, 100);
  let text = "", bodyStarted = false;
  const payload = { species, features, image: grabFrame(), history };
  const res = await fetch("/api/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    clearInterval(qTick);
    queueEl.style.display = "none";
    body.textContent = "…the interpreter blinked out (gateway " + res.status + "). Try again.";
    return;
  }
  if ($("#race")?.checked) raceRival(payload);
  await pump(res, {
    delta(d) {
      if (qi >= 0) {
        clearInterval(qTick);
        qi = -1;
        queueEl.textContent = "streaming…";
      }
      text += d;
      const split = text.split("\n---\n");
      if (split.length > 1 || bodyStarted) {
        bodyStarted = true;
        const hdr = split[0];
        const vocal = hdr.match(/VOCAL:\s*(\S+)/)?.[1];
        const mood = hdr.match(/MOOD:\s*(.+)/)?.[1]?.trim();
        const conf = hdr.match(/CONFIDENCE:\s*(\S+)/)?.[1];
        meta.textContent =
          `${species}${vocal ? " · " + vocal : ""}${mood ? " · " + mood : ""}` +
          (conf ? ` · ${(parseFloat(conf) * 100).toFixed(0)}%` : "") +
          ` · ${features.f0Median}Hz`;
        body.textContent = split.slice(1).join("\n---\n");
      }
    },
    done(p) {
      clearInterval(qTick);
      queueEl.style.display = "none";
      const tps = Math.round(p.approxTokens / (p.elapsedMs / 1000));
      $("#tps").textContent = tps + " tok/s";
      $("#tpsBar").style.width = Math.min(100, tps / 30) + "%";
    },
  });
  const elapsed = (performance.now() - t0) / 1000;
  $("#lat").textContent = elapsed.toFixed(2) + "s";
  const said = body.textContent.trim();
  if (said) history.push(`${species}: "${said}"`);
  avatarReact("speak");
}

async function pump(res, h) {
  const rdr = res.body.getReader();
  const dec = new TextDecoder();
  let carry = "";
  for (;;) {
    const { done, value } = await rdr.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop();
    for (const l of lines) {
      if (!l.startsWith("data:")) continue;
      const p = JSON.parse(l.slice(5));
      if (p.done) h.done(p);
      else if (p.delta) h.delta(p.delta);
    }
  }
}

// side-by-side: same prompt on a GPU provider, racing the Cerebras bubble
async function raceRival(payload) {
  const card = bubble("rival", "");
  const meta = card.querySelector(".meta");
  const body = card.querySelector(".body");
  meta.textContent = "groq · same prompt · waiting…";
  const t0 = performance.now();
  const res = await fetch("/api/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    meta.textContent = "groq · offline (no key)";
    return;
  }
  let text = "", bodyStarted = false;
  await pump(res, {
    delta(d) {
      text += d;
      const split = text.split("\n---\n");
      if (split.length > 1 || bodyStarted) {
        bodyStarted = true;
        body.textContent = split.slice(1).join("\n---\n");
      }
      meta.textContent = `groq · ${((performance.now() - t0) / 1000).toFixed(1)}s`;
    },
    done(p) {
      const tps = Math.round(p.approxTokens / (p.elapsedMs / 1000));
      meta.textContent = `groq · ${tps} tok/s · ${(p.elapsedMs / 1000).toFixed(1)}s`;
    },
  });
}

// ---------- talk back ----------
$("#reply").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("#replyText").value.trim();
  if (!text) return;
  $("#replyText").value = "";
  bubble("human", text);
  history.push(`you: "${text}"`);
  const res = await fetch("/api/vocalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, species }),
  });
  const { script } = await res.json();
  if (!script) return bubble("system", "vocalizer failed — try again");
  bubble("voc", script);
  avatarReact("vocalize");
  playScript(script);
};

// ---------- transcript UI ----------
function bubble(kind, content) {
  const div = document.createElement("div");
  div.className = "msg " + kind;
  if (kind === "voc") {
    const gloss = content.map((s) => `${s.type}(${s.gloss || "?"})`).join(" → ");
    div.innerHTML = `<div class="meta">you → ${species}</div><div class="body vocline">${gloss}</div>`;
  } else if (kind === "animal" || kind === "rival") {
    div.innerHTML = `<div class="meta"></div><div class="body"></div>`;
  } else {
    div.innerHTML = `<div class="body">${escapeHtml(content)}</div>`;
  }
  $("#transcript").appendChild(div);
  $("#transcript").scrollTop = 1e6;
  return div;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- spectrogram waterfall ----------
const sg = $("#spec").getContext("2d");
let specStream;
function drawSpectrogram(buf) {
  // static spectrogram of the captured clip (FFT columns)
  const pcm = buf.getChannelData(0), sr = buf.sampleRate, N = 1024;
  const c = $("#spec"), w = c.width, h = c.height;
  sg.fillStyle = "#0c0d12";
  sg.fillRect(0, 0, w, h);
  const cols = Math.min(w, Math.floor(pcm.length / 256));
  for (let col = 0; col < cols; col++) {
    const off = col * 256;
    for (let k = 0; k < h; k++) {
      const bin = Math.floor((k / h) * (N / 8));
      let re = 0, im = 0;
      for (let n = 0; n < N; n += 8) {
        const a = (-2 * Math.PI * bin * n) / N;
        re += (pcm[off + n] || 0) * Math.cos(a);
        im += (pcm[off + n] || 0) * Math.sin(a);
      }
      const m = Math.min(1, Math.sqrt(re * re + im * im) * 0.02);
      if (m > 0.06) {
        sg.fillStyle = `rgba(255,138,92,${m})`;
        sg.fillRect(col, h - k - 1, 1, 1);
      }
    }
  }
}
function drawContour(f) {
  const c = $("#contour"), x = c.getContext("2d");
  x.clearRect(0, 0, c.width, c.height);
  x.strokeStyle = "#7dd8a8";
  x.lineWidth = 2;
  x.beginPath();
  const lo = f.f0Min * 0.9, hi = f.f0Max * 1.1 || 1;
  f.contour.forEach((v, i) => {
    const px = (i / (f.contour.length - 1)) * c.width;
    const py = c.height - ((v - lo) / (hi - lo || 1)) * c.height;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  });
  x.stroke();
}

// ---------- avatar ----------
function avatarReact(kind) {
  const a = $("#avatar");
  a.classList.remove("speak", "vocalize");
  void a.offsetWidth;
  a.classList.add(kind);
  setTimeout(() => a.classList.remove(kind), 1600);
}

// ---------- config ----------
const cfg = await (await fetch("/api/config")).json();
$("#model").textContent = cfg.model;
