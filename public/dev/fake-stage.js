import { decode, playBuffer } from "../audio.js";
import { analyzeBuffer } from "../acoustics.js";
import { playScript } from "../synth.js";

const UTTERANCES = {
  cat: "The bowl has been visibly empty for eleven minutes. I am not angry. I am simply documenting it for later.",
  dog: "Someone is at the door! Someone is at the door! It might be you! Is it you?",
};

let runId = 0;

function wait(ms, token) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms);
    token.timers.add(t);
  });
}

async function streamUtterance(stage, lane, text, t0, queueMs, replay, token, deltaMs = 12) {
  stage.emit("interpret:header", { lane, vocal: "solicitation", mood: "impatient", confidence: 0.82 });
  if (lane === "cerebras") stage.set("streaming");
  let body = "";
  let chars = 0;
  const tFirst = performance.now();
  let first = true;
  for (let i = 0; i < text.length; ) {
    if (token.id !== runId) return;
    const chunk = text.slice(i, i + 3 + Math.floor(Math.random() * 4));
    i += chunk.length;
    body += chunk;
    chars += chunk.length;
    const tps = (chars / 4) / ((performance.now() - tFirst) / 1000 || 0.001);
    stage.emit("interpret:delta", { lane, text: chunk, t: performance.now(), first, tps });
    first = false;
    if (i < text.length) await wait(deltaMs, token);
  }
  const decodeMs = performance.now() - tFirst;
  stage.emit("interpret:done", {
    lane, text, queueMs, decodeMs,
    tokens: Math.ceil(chars / 4),
    tps: (chars / 4) / (decodeMs / 1000 || 0.001),
    replay,
  });
}

export async function runSession(stage, { clip = "cat-pleading.wav", variant = "ok" } = {}) {
  const token = { id: ++runId, timers: new Set() };
  const species = clip.startsWith("dog-") ? "dog" : "cat";
  stage.setSpecies(species);

  const buf = await decode(await (await fetch("/clips/" + clip)).arrayBuffer());
  const { analyser, startedAt, durationMs } = playBuffer(buf);
  stage.emit("capture:start", { source: "clip", analyser, startedAt, durationMs });
  stage.set("listening");

  if (!await wait(durationMs, token)) return;
  if (token.id !== runId) return;
  stage.set("analysing");
  const features = analyzeBuffer(buf);
  stage.emit("analysis", { features, buffer: buf });

  stage.set("queued");
  const t0 = performance.now();
  stage.emit("interpret:start", { lane: "cerebras", t0 });

  if (variant === "race") {
    const gt0 = performance.now();
    stage.emit("interpret:start", { lane: "groq", t0: gt0 });
    const gToken = token;
    (async () => {
      await wait(900, gToken);
      if (gToken.id !== runId) return;
      await streamUtterance(stage, "groq", UTTERANCES[species], gt0, performance.now() - gt0, false, gToken, 45);
    })();
  }

  const queueMs = variant === "ok" || variant === "race" ? 1200 : 4000;
  await wait(queueMs, token);
  if (token.id !== runId) return;

  if (variant === "timeout") {
    stage.emit("interpret:error", { lane: "cerebras", reason: "timeout", status: null });
    stage.set("error", { reason: "timeout" });
    return;
  }
  if (variant === "replay") {
    stage.emit("interpret:error", { lane: "cerebras", reason: "timeout", status: null });
  }
  await streamUtterance(stage, "cerebras", UTTERANCES[species], t0, queueMs, variant === "replay", token);
  if (token.id !== runId) return;
  stage.set("done");
}

export async function runReply(stage, text = "dinner is in ten minutes, be patient") {
  stage.emit("reply:sent", { text });
  await new Promise((r) => setTimeout(r, 600));
  const script = [
    { type: "meow", shape: "arch", dur: 0.5, pitch: 520, intensity: 0.7, gloss: "dinner" },
    { type: "trill", shape: "rising", dur: 0.3, pitch: 640, intensity: 0.5, gloss: "soon" },
    { type: "meow", shape: "falling", dur: 0.6, pitch: 480, intensity: 0.6, gloss: "be patient" },
  ];
  let at = 0;
  const schedule = script.map((s) => {
    const d = Math.min(1.4, Math.max(0.08, s.dur || 0.3));
    const entry = { tMs: at * 1000, durMs: d * 1000, type: s.type, shape: s.shape, pitch: s.pitch, gloss: s.gloss };
    at += d + 0.09;
    return entry;
  });
  playScript(script);
  stage.emit("vocalize:play", { script, schedule, startedAt: performance.now(), totalMs: at * 1000 });
}

export async function runReplyError(stage) {
  stage.emit("reply:sent", { text: "dinner is in ten minutes, be patient" });
  stage.emit("vocalize:error", { reason: "timeout" });
}
