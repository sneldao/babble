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

// The workspace SOUL.md owns the output contract; we send user messages only.
const BABBLE_WORKSPACE = process.env.BABBLE_WORKSPACE || "agent-workspace";

const RIVAL_AGENT = process.env.RIVAL_AGENT || "babble-gpu";
const RIVAL_BACKEND = process.env.RIVAL_BACKEND || "nebius/moonshotai/Kimi-K3.1-Pro";
const RIVAL_LABEL = process.env.RIVAL_LABEL || "Nebius · GPU";

const sessions = new Map(); // sessionId -> { pet, species, turns, memorySent, ended }

const SESSION_ID_RE = /^[a-z0-9-]{8,64}$/i;
const PET_RE = /^[a-z0-9-]{1,32}$/;

function sessionKeyFor(agentId, sessionId) {
  return `agent:${agentId}:babble-${sessionId}`;
}

function readSession(body, fallbackSpecies) {
  const sessionId = typeof body.sessionId === "string" && SESSION_ID_RE.test(body.sessionId)
    ? body.sessionId : null;
  let pet = typeof body.pet === "string" ? body.pet.toLowerCase() : "";
  if (!PET_RE.test(pet)) pet = String(fallbackSpecies || body.species || "cat").toLowerCase();
  return { sessionId, pet };
}

function ensureSession(sessionId, pet, species) {
  if (!sessionId) return null;
  let s = sessions.get(sessionId);
  if (!s) {
    s = { pet, species, turns: 0, memorySent: false, ended: false };
    sessions.set(sessionId, s);
  }
  return s;
}

async function readPetMemory(pet) {
  try {
    const text = await readFile(join(BABBLE_WORKSPACE, "memory", "pets", `${pet}.md`), "utf8");
    return text.slice(0, 2000);
  } catch {
    return null;
  }
}

let rivalCache = { at: 0, available: false };
async function rivalAvailable() {
  if (Date.now() - rivalCache.at < 30_000) return rivalCache.available;
  let available = false;
  try {
    const res = await fetch(`${GATEWAY}/v1/models`, {
      headers: GATEWAY_TOKEN ? { authorization: `Bearer ${GATEWAY_TOKEN}` } : {},
      signal: AbortSignal.timeout(2000),
    });
    const json = await res.json().catch(() => null);
    const wanted = `openclaw/${RIVAL_AGENT}`;
    available = Array.isArray(json?.data) && json.data.some((m) => m.id === wanted);
  } catch {}
  rivalCache = { at: Date.now(), available };
  return available;
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

async function gatewayChat(messages, {
  stream = true, retries = 3, signal,
  model = MODEL, backend = BACKEND_MODEL, sessionKey = null,
} = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(GATEWAY_TOKEN ? { authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
        "x-openclaw-model": backend,
        ...(sessionKey ? { "x-openclaw-session-key": sessionKey } : {}),
      },
      body: JSON.stringify({
        model, stream, messages,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
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

function buildInterpretMessages(body, petMemory) {
  const { species = "cat", features, image } = body;

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
    (petMemory ? `\npet_memory=${petMemory}` : "");

  const content = image
    ? [
        { type: "text", text: userText + "\nA still frame is attached — factor posture, ears and tail into your read." },
        { type: "image_url", image_url: { url: image } },
      ]
    : userText;

  return [{ role: "user", content }];
}

// SSE headers and the first queued event go out BEFORE the upstream call, so
// the browser sees the queue honestly while the gateway is still thinking.
async function pumpSse(res, signal, tag, getUpstream) {
  const send = sse(res);
  const t0 = Date.now();
  let headersMs = null, firstMs = null, status = null, outcome = "done";
  let chars = 0, usage = null, tokens = 0, reasoningTokens = null, tokensEstimated = true;
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
          const chunk = JSON.parse(payload);
          if (chunk?.usage) usage = chunk.usage;
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) {
            if (firstMs === null) {
              firstMs = Date.now() - t0;
              clearInterval(queued);
            }
            chars += delta.length;
            send({ delta });
          }
        } catch {}
      }
    }
    if (typeof usage?.completion_tokens === "number") {
      reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
      tokens = usage.completion_tokens - reasoningTokens;
      tokensEstimated = false;
    } else {
      tokens = Math.round(chars / 4);
    }
    try {
      send({ done: true, elapsedMs: Date.now() - t0, tokens, reasoningTokens, tokensEstimated });
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
    console.log(`[${tag}] status=${status} headersMs=${headersMs} firstMs=${firstMs} totalMs=${Date.now() - t0} tokens=${tokens} reasoning=${reasoningTokens} est=${tokensEstimated} outcome=${outcome}`);
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
  const { sessionId, pet } = readSession(body);
  const session = ensureSession(sessionId, pet, body.species);
  let petMemory = null;
  if (session && !session.memorySent) {
    petMemory = await readPetMemory(session.pet);
    if (petMemory !== null) session.memorySent = true;
  }
  if (session) session.turns++;
  const sessionKey = sessionId ? sessionKeyFor(AGENT_ID, sessionId) : null;
  return pumpSse(res, ac.signal, "interpret lane=cerebras", () =>
    gatewayChat(buildInterpretMessages(body, petMemory), { signal: ac.signal, sessionKey }));
}

async function handleCompare(req, res) {
  if (!await rivalAvailable()) {
    console.log("[compare lane=rival] status=501 headersMs=null firstMs=null totalMs=0 tokens=0 reasoning=null est=true outcome=error");
    res.writeHead(501, { "content-type": "text/plain" });
    return res.end(`rival agent ${RIVAL_AGENT} not configured`);
  }
  const ac = abortOnClose(res);
  const body = await readBody(req);
  const { sessionId } = readSession(body);
  const sessionKey = sessionId ? sessionKeyFor(RIVAL_AGENT, sessionId) : null;
  return pumpSse(res, ac.signal, "compare lane=rival", () =>
    gatewayChat(buildInterpretMessages(body), {
      signal: ac.signal,
      model: `openclaw/${RIVAL_AGENT}`,
      backend: RIVAL_BACKEND,
      sessionKey,
    }));
}

async function handleVocalize(req, res) {
  const ac = abortOnClose(res);
  const t0 = Date.now();
  const body = await readBody(req);
  const { sessionId, pet } = readSession(body);
  ensureSession(sessionId, pet, body.species);
  const sessionKey = sessionId ? sessionKeyFor(AGENT_ID, sessionId) : null;
  let text = "", reason = null;
  try {
    // stream upstream (the gateway's streaming path tolerates long queues better)
    const upstream = await gatewayChat([
      { role: "user", content: `VOCALIZE — species=${body.species || "cat"}\nhuman_says="${String(body.text || "").slice(0, 300)}"` },
    ], { signal: ac.signal, sessionKey });
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

async function handleSessionEnd(req, res) {
  const body = await readBody(req);
  res.writeHead(202).end();
  const { sessionId } = readSession(body);
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session || session.turns < 1 || session.ended) return;
  session.ended = true;
  const species = String(session.species || body.species || "cat");
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  let status = null, firstLine = "";
  try {
    const upstream = await gatewayChat([
      { role: "user", content: `SESSION END — pet=${session.pet} species=${species}\nfile=memory/pets/${session.pet}.md` },
    ], { stream: false, signal: ac.signal, sessionKey: sessionKeyFor(AGENT_ID, sessionId) });
    status = upstream.status;
    if (upstream.ok) {
      const json = await upstream.json().catch(() => null);
      firstLine = String(json?.choices?.[0]?.message?.content || "").split("\n")[0];
    } else {
      await upstream.text().catch(() => {});
    }
  } catch (e) {
    status = ac.signal.aborted ? "timeout" : "error";
  } finally {
    clearTimeout(timer);
    console.log(`[memory] pet=${session.pet} status=${status} totalMs=${Date.now() - t0} reply=${firstLine}`);
  }
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
  if (!clean.map((d) => d.text).join("").trim()) return res.writeHead(400).end("empty replay");
  const header = body.header && typeof body.header === "object" ? body.header : {};
  const record = {
    clip,
    species: String(body.species || "cat"),
    header: {
      vocal: header.vocal ?? null,
      mood: header.mood ?? null,
      confidence: typeof header.confidence === "number" ? header.confidence : null,
      evidence: typeof header.evidence === "string" ? header.evidence.slice(0, 300) : null,
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
    if (req.method === "POST" && req.url === "/api/session/end") return handleSessionEnd(req, res);
    if (req.method === "POST" && req.url === "/api/dev/replay") return handleDevReplay(req, res);
    if (req.method === "GET" && req.url === "/api/config") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        model: MODEL, gateway: GATEWAY, agent: AGENT_ID, backend: BACKEND_MODEL,
        rival: { label: RIVAL_LABEL, agent: RIVAL_AGENT, backend: RIVAL_BACKEND, available: await rivalAvailable() },
        record: process.env.BABBLE_RECORD === "1",
      }));
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
