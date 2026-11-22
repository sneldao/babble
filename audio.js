let ctx, out;

export function getCtx() { return (ctx ??= new (window.AudioContext || window.webkitAudioContext)()); }
export function unlock() { const c = getCtx(); if (c.state !== "running") return c.resume(); return Promise.resolve(); }
export function getOut() { if (!out) { out = getCtx().createGain(); out.connect(getCtx().destination); } return out; }
export function getFxOut() { return getOut(); }
export async function decode(arrayBuffer) { return getCtx().decodeAudioData(arrayBuffer); }
export function playBuffer(buf) {
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = buf;
  const analyser = c.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser).connect(getOut());
  src.start();
  return { analyser, startedAt: performance.now(), durationMs: buf.duration * 1000 };
}
