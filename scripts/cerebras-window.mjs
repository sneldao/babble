#!/usr/bin/env node
// Shows whether the Cerebras trial endpoint is admitting requests right now.
// Use it before recording a live take: start the take on an OPEN streak.
// Usage: node scripts/cerebras-window.mjs [intervalMs=2000]
// Key: CEREBRAS_API_KEY, else the cerebras provider key in ~/.openclaw/openclaw.json.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODEL = process.env.BABBLE_BACKEND || "moonshotai-kimi-k3.1-pro-trial";
const intervalMs = Number(process.argv[2] || 2000);

function resolveKey() {
  if (process.env.CEREBRAS_API_KEY) return process.env.CEREBRAS_API_KEY;
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".openclaw", "openclaw.json"), "utf8"));
    const k = cfg?.models?.providers?.cerebras?.apiKey || "";
    return k.startsWith("${") ? process.env[k.slice(2, -1)] || "" : k;
  } catch {
    return "";
  }
}

const key = resolveKey();
if (!key) {
  console.error("no Cerebras key: set CEREBRAS_API_KEY");
  process.exit(1);
}

let streak = 0, open = 0, total = 0;
for (;;) {
  const t0 = Date.now();
  let line;
  try {
    const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json().catch(() => ({}));
    total++;
    if (r.ok) {
      const q = body?.time_info?.queue_time;
      const fast = Date.now() - t0 < 3000;
      streak = fast ? streak + 1 : 0;
      if (fast) open++;
      line = `${fast ? "OPEN  " : "SLOW  "} ${Date.now() - t0}ms  queue=${q != null ? q.toFixed(2) + "s" : "?"}  streak=${streak}`;
    } else {
      streak = 0;
      line = `CLOSED ${r.status} ${body?.code || ""}`;
    }
  } catch (e) {
    total++;
    streak = 0;
    line = `SLOW   no answer in ${Date.now() - t0}ms (${e.name})`;
  }
  console.log(`${new Date().toISOString().slice(11, 19)}  ${line}  open ${open}/${total}${streak >= 3 ? "  <- go" : ""}`);
  await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (Date.now() - t0))));
}
