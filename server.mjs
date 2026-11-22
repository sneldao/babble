#!/usr/bin/env node
// Babble — interspecies interpreter server.
// Streams OpenClaw gateway (/v1/chat/completions) → SSE to the browser.
// Zero dependencies: node >= 20.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { readFileSync as readSync } from "node:fs";

// tiny .env loader (no deps)
try {
  for (const line of readSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const PORT = Number(process.env.PORT || 4319);
const GATEWAY = process.env.OPENCLAW_GATEWAY || "http://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_TOKEN || "";
const MODEL = process.env.BABBLE_MODEL || "openclaw/babble";
const BACKEND_MODEL = process.env.BABBLE_BACKEND || "moonshotai-kimi-k3.1-pro-trial";
const AGENT_ID = process.env.BABBLE_AGENT || "babble";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".webm": "audio/webm",
  ".woff2": "font/woff2",
};

const INTERPRET_SYSTEM = `You are the Babble interpreter — a real-time translator between animals and humans.
You receive structured acoustic measurements (and occasionally a still frame) captured from a live microphone.
Interpret them against ethology: cats vocalize mainly AT humans; meow classes (solicitation, greeting, protest, distress) differ in duration, f0 contour and intensity; dog barks split into alarm/stranger vs play by pitch, harshness and repetition rate; infant cries split into hunger/discomfort/attention by rhythm and tension.

Output contract — STRICT, no markdown, no preamble:
Line 1: VOCAL: <class e.g. solicitation|greeting|protest|distress|alarm|play|hunger|discomfort|attention|contentment>
Line 2: MOOD: <one or two words>
Line 3: CONFIDENCE: <0.00-1.00>
Line 4: ---
Remaining lines: the animal's utterance in first person, 1-3 short sentences, in-character (aloof cat / eager dog / needy infant). No emoji.`;

const VOCALIZE_SYSTEM = `You are the Babble vocalizer — you render human speech as an animal vocalization script.
Output STRICT JSON only: {"script":[{"type":"<meow|trill|chirp|hiss|bark|yip|whine|cry|gurgle>","shape":"<rising|falling|arch|flat|warble>","dur":<sec 0.1-1.2>,"pitch":<Hz base 150-900>,"intensity":<0-1>,"gloss":"<what this syllable means>"}]}
Rules: 1-4 syllables. Match species-typical ranges (cat meow ~400-700Hz arch; dog bark ~250-500Hz short falling; baby cry ~350-450Hz long flat). Keep it performable in under 4 seconds total.`;

const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "moonshotai/kimi-k2-instruct-0905";

function groqChat(messages, signal) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, stream: true, messages }),
    signal,
  });
}

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

async function gatewayChat(messages, { stream = true, retries = 3, signal } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(GATEWAY_TOKEN ? { authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
        "x-openclaw-model": BACKEND_MODEL,
      },
      body: JSON.stringify({ model: MODEL, stream, messages }),
      signal,
    });
    if (res.ok || attempt === retries) return res;
    const status = res.status;
    await res.text().catch(() => {});
    if (status !== 429 && status !== 502 && status !== 503) return res;
    await abortableSleep(2500 * (attempt + 1), signal);
  }
}

function sse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function buildInterpretMessages(body) {
  const { species = "cat", features, image, history = [] } = body;

  const featSummary = features
    ? `duration_ms=${features.durationMs} f0_mean=${features.f0Mean}Hz f0_median=${features.f0Median}Hz ` +
      `f0_min=${features.f0Min} f0_max=${features.f0Max} contour_shape=${features.shape} ` +
      `voiced_ratio=${features.voicedRatio} rms_mean=${features.rmsMean} spectral_centroid=${features.spectralCentroid}Hz ` +
      `calls_detected=${features.calls ?? 1} ` +
      (features.segments?.length > 1
        ? `segments=${features.segments.map((s) => `${s.durMs}ms@${s.f0Median}Hz/${s.shape}`).join(" ")} `
        : "") +
      `contour=[${(features.contour || []).join(",")}] envelope=[${(features.envelope || []).join(",")}]`
    : "no acoustic data";

  const userText =
    `LIVE CAPTURE — species=${species}\n${featSummary}` +
    (features?.note ? `\ncontext=${features.note}` : "") +
    (history.length ? `\nrecent_context=${JSON.stringify(history.slice(-6))}` : "");

  const content = image
    ? [
        { type: "text", text: userText + "\nA still frame is attached — factor posture, ears and tail into your read." },
        { type: "image_url", image_url: { url: image } },
      ]
    : userText;

  return [
    { role: "system", content: INTERPRET_SYSTEM },
    { role: "user", content },
  ];
}

// SSE headers and the first queued event go out BEFORE the upstream call, so
// the browser sees the queue honestly while the gateway is still thinking.
async function pumpSse(res, signal, tag, getUpstream) {
  const send = sse(res);
  const t0 = Date.now();
  let headersMs = null, firstMs = null, tokens = 0, status = null, outcome = "done";
  const queued = setInterval(() => {
    try { send({ queued: true, ms: Date.now() - t0 }); } catch {}
  }, 1000);
  try { send({ queued: true, ms: 0 }); } catch {}
  try {
    const upstream = await getUpstream();
    headersMs = Date.now() - t0;
    status = upstream.status;
    if (!upstream.ok || !upstream.body) {
      outcome = "error";
      try {
        send({ error: "upstream", status: upstream.ok ? null : upstream.status });
        res.end();
      } catch {}
      await upstream.text().catch(() => {});
      return;
    }
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) {
            if (firstMs === null) {
              firstMs = Date.now() - t0;
              clearInterval(queued);
            }
            tokens += Math.max(1, Math.round(delta.length / 4));
            send({ delta });
          }
        } catch {}
      }
    }
    try {
      send({ done: true, elapsedMs: Date.now() - t0, approxTokens: tokens });
      res.end();
    } catch {}
  } catch (e) {
    outcome = signal.aborted ? "aborted" : "error";
    if (!res.writableEnded) {
      try {
        send({ error: outcome === "aborted" ? "aborted" : "upstream", status });
        res.end();
      } catch {}
    }
  } finally {
    clearInterval(queued);
    console.log(`[${tag}] status=${status} headersMs=${headersMs} firstMs=${firstMs} totalMs=${Date.now() - t0} tokens=${tokens} outcome=${outcome}`);
  }
}

function abortOnClose(res) {
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  return ac;
}

async function handleInterpret(req, res) {
  const ac = abortOnClose(res);
  const body = await readBody(req);
  return pumpSse(res, ac.signal, "interpret lane=cerebras", () =>
    gatewayChat(buildInterpretMessages(body), { signal: ac.signal }));
}

async function handleCompare(req, res) {
  if (!GROQ_KEY) {
    console.log("[compare lane=groq] status=501 headersMs=null firstMs=null totalMs=0 tokens=0 outcome=error");
    return res.writeHead(501).end("no GROQ_API_KEY configured");
  }
  const ac = abortOnClose(res);
  const body = await readBody(req);
  return pumpSse(res, ac.signal, "compare lane=groq", () =>
    groqChat(buildInterpretMessages(body), ac.signal));
}

async function handleVocalize(req, res) {
  const ac = abortOnClose(res);
  const t0 = Date.now();
  const body = await readBody(req);
  let text = "", reason = null;
  try {
    // stream upstream (the gateway's streaming path tolerates long queues better)
    const upstream = await gatewayChat([
      { role: "system", content: VOCALIZE_SYSTEM },
      { role: "user", content: `species=${body.species || "cat"}\nhuman_says="${String(body.text || "").slice(0, 300)}"` },
    ], { signal: ac.signal });
    if (upstream.ok && upstream.body) {
      const rdr = upstream.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await rdr.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const p = line.slice(5).trim();
          if (p === "[DONE]") continue;
          try {
            text += JSON.parse(p)?.choices?.[0]?.delta?.content || "";
          } catch {}
        }
      }
    } else if (upstream.ok) {
      const json = await upstream.json().catch(() => null);
      text = json?.choices?.[0]?.message?.content || "";
    } else {
      reason = "upstream";
      await upstream.text().catch(() => {});
    }
  } catch (e) {
    reason = ac.signal.aborted ? "aborted" : "upstream";
  }
  let script = null;
  if (!reason) {
    try {
      const m = text.match(/\{[\s\S]*\}/);
      script = m ? JSON.parse(m[0]).script : null;
    } catch {}
    if (!script) reason = "parse";
  }
  const outcome = reason ? (reason === "aborted" ? "aborted" : "error") : "done";
  console.log(`[vocalize] status=${script ? 200 : 502} headersMs=null firstMs=null totalMs=${Date.now() - t0} tokens=0 outcome=${outcome}`);
  if (res.writableEnded) return;
  if (reason === "aborted") return;
  res.writeHead(script ? 200 : 502, { "content-type": "application/json" });
  res.end(JSON.stringify(script ? { script } : { script: null, reason }));
}

async function handleDevReplay(req, res) {
  if (process.env.BABBLE_RECORD !== "1") return res.writeHead(403).end();
  const body = await readBody(req);
  const clip = String(body.clip || "");
  if (!/^[a-z0-9-]+\.wav$/.test(clip)) return res.writeHead(400).end("bad clip");
  const deltas = Array.isArray(body.deltas) ? body.deltas.slice(0, 2000) : [];
  const clean = deltas.map((d) => ({
    tMs: Math.max(0, Number(d.tMs) || 0),
    text: String(d.text ?? "").slice(0, 200),
  }));
  const header = body.header && typeof body.header === "object" ? body.header : {};
  const record = {
    clip,
    species: String(body.species || "cat"),
    header: {
      vocal: header.vocal ?? null,
      mood: header.mood ?? null,
      confidence: typeof header.confidence === "number" ? header.confidence : null,
    },
    deltas: clean,
    queueMs: Number(body.queueMs) || 0,
    decodeMs: Number(body.decodeMs) || 0,
    recordedAt: new Date().toISOString(),
  };
  const { writeFile, mkdir } = await import("node:fs/promises");
  const name = clip.replace(/\.wav$/, "");
  await mkdir(join("public", "replays"), { recursive: true });
  await writeFile(join("public", "replays", name + ".json"), JSON.stringify(record, null, 2));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, file: `public/replays/${name}.json` }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 8e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/interpret") return handleInterpret(req, res);
    if (req.method === "POST" && req.url === "/api/compare") return handleCompare(req, res);
    if (req.method === "POST" && req.url === "/api/vocalize") return handleVocalize(req, res);
    if (req.method === "POST" && req.url === "/api/dev/replay") return handleDevReplay(req, res);
    if (req.method === "GET" && req.url === "/api/config") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ model: MODEL, gateway: GATEWAY, agent: AGENT_ID, record: process.env.BABBLE_RECORD === "1" }));
    }
    if (req.method !== "GET") return res.writeHead(405).end();
    const path = normalize(req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]);
    const file = join("public", path);
    if (!file.startsWith("public")) return res.writeHead(403).end();
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, () => console.log(`babble → http://localhost:${PORT}  (gateway ${GATEWAY}, model ${MODEL})`));
