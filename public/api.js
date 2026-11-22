// server wire: one JSON object per `data:` line — {queued}, {delta}, {done}, {error}.
const HEADER_LIMIT = 400;

export function interpret(payload, { lane = "cerebras", budgetMs = 12000, stallMs = 8000, on = {} } = {}) {
  const ac = new AbortController();
  const promise = (async () => {
    const t0 = performance.now();
    let gotContent = false;
    let lastEventAt = t0;
    const watchdog = setInterval(() => {
      const now = performance.now();
      if (!gotContent && now - t0 > budgetMs) ac.abort("timeout");
      else if (gotContent && now - lastEventAt > stallMs) ac.abort("timeout");
    }, 50);

    let res;
    try {
      res = await fetch(lane === "rival" ? "api/compare" : "api/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
    } catch (e) {
      clearInterval(watchdog);
      return { ok: false, reason: ac.signal.aborted ? "timeout" : "network", status: null };
    }
    if (!res.ok || !res.body) {
      clearInterval(watchdog);
      return { ok: false, reason: "http", status: res.status ?? null };
    }

    let text = "", body = "", header = null, headerFired = false;
    let firstContentAt = null, firstBodyAt = null;
    let contentChars = 0, donePayload = null, errorPayload = null;
    const deltas = [];
    const rdr = res.body.getReader();
    const dec = new TextDecoder();
    let carry = "";
    const fireHeader = (h) => {
      if (headerFired) return;
      headerFired = true;
      header = h;
      on.header?.(h);
    };
    const fireBody = (chunk) => {
      if (!chunk) return;
      if (firstBodyAt === null) firstBodyAt = performance.now();
      body += chunk;
      const elapsed = Math.max(50, performance.now() - firstContentAt);
      const tps = Math.round(contentChars / 4) / (elapsed / 1000);
      deltas.push({ tMs: performance.now() - firstBodyAt, text: chunk });
      on.delta?.({ text: chunk, t: performance.now(), first: deltas.length === 1, tps, tpsEstimated: true });
    };

    try {
      for (;;) {
        const { done, value } = await rdr.read();
        if (done) break;
        lastEventAt = performance.now();
        carry += dec.decode(value, { stream: true });
        const lines = carry.split("\n");
        carry = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let p;
          try { p = JSON.parse(line.slice(5)); } catch { continue; }
          if (p.queued) {
            on.queued?.(p.ms);
          } else if (p.error) {
            errorPayload = p;
          } else if (p.done) {
            donePayload = p;
          } else if (typeof p.delta === "string" && p.delta) {
            gotContent = true;
            if (firstContentAt === null) firstContentAt = performance.now();
            contentChars += p.delta.length;
            text += p.delta;
            if (!headerFired) {
              const split = text.indexOf("\n---\n");
              if (split >= 0) {
                const hdr = text.slice(0, split);
                fireHeader({
                  vocal: hdr.match(/VOCAL:\s*(\S+)/)?.[1] ?? null,
                  mood: hdr.match(/MOOD:\s*(.+)/)?.[1]?.trim() ?? null,
                  confidence: (() => { const c = parseFloat(hdr.match(/CONFIDENCE:\s*(\S+)/)?.[1]); return Number.isNaN(c) ? null : Math.min(1, Math.max(0, c)); })(),
                  evidence: hdr.match(/EVIDENCE:\s*(.+)/)?.[1]?.trim() ?? null,
                });
                fireBody(text.slice(split + 5).replace(/^\n/, ""));
                text = "";
              } else if (text.length > HEADER_LIMIT) {
                fireHeader({ vocal: null, mood: null, confidence: null, evidence: null });
                fireBody(text);
                text = "";
              }
            } else {
              fireBody(p.delta);
            }
          }
        }
      }
    } catch (e) {
      clearInterval(watchdog);
      return { ok: false, reason: ac.signal.aborted ? "timeout" : "network", status: null };
    }
    clearInterval(watchdog);
    if (errorPayload) return { ok: false, reason: "http", status: errorPayload.status ?? null };
    if (!donePayload) return { ok: false, reason: "network", status: null };
    if (!body.trim()) return { ok: false, reason: "empty", status: null };
    if (!headerFired) fireHeader({ vocal: null, mood: null, confidence: null, evidence: null });
    const now = performance.now();
    const queueMs = firstContentAt === null ? now - t0 : firstContentAt - t0;
    const decodeMs = firstContentAt === null ? 0 : now - firstContentAt;
    const tokens = typeof donePayload.tokens === "number" ? donePayload.tokens : Math.round(contentChars / 4);
    return {
      ok: true,
      text: body,
      header,
      deltas,
      queueMs,
      decodeMs,
      tokens,
      reasoningTokens: donePayload.reasoningTokens ?? null,
      tokensEstimated: donePayload.tokensEstimated ?? true,
      tps: tokens / Math.max(0.05, decodeMs / 1000),
    };
  })();
  promise.abort = () => ac.abort("timeout");
  return promise;
}

export async function vocalize(payload, { budgetMs = 12000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort("timeout"), budgetMs);
  let res;
  try {
    res = await fetch("api/vocalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(t);
    return { ok: false, reason: ac.signal.aborted ? "timeout" : "network", status: null };
  }
  clearTimeout(t);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return { ok: false, reason: body?.reason === "parse" ? "parse" : "http", status: res.status };
  }
  const body = await res.json().catch(() => null);
  if (!body?.script) return { ok: false, reason: "parse", status: res.status };
  return { ok: true, script: body.script };
}
