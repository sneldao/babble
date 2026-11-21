// Babble vocalizer — renders the agent's vocalization script as audio chirps.

const ctx = () => (window._babbleCtx ??= new AudioContext());

// one syllable: pitch envelope + vibrato + breath noise + formant coloration
export function playSyllable(s, at = 0) {
  const c = ctx();
  const t0 = c.currentTime + at;
  const dur = Math.min(1.4, Math.max(0.08, s.dur || 0.3));
  const base = s.pitch || 500;
  const vol = Math.min(1, Math.max(0.05, s.intensity || 0.6)) * 0.5;

  const pitch = new Float32Array(128).map((_, i) => {
    const u = i / 127;
    let f = base;
    switch (s.shape) {
      case "rising": f = base * (0.75 + 0.5 * u); break;
      case "falling": f = base * (1.3 - 0.55 * u); break;
      case "arch": f = base * (0.85 + 0.4 * Math.sin(Math.PI * u)); break;
      case "warble": f = base * (1 + 0.12 * Math.sin(2 * Math.PI * 6 * u)); break;
      default: f = base;
    }
    return f * (1 + 0.02 * Math.sin(2 * Math.PI * 5 * u + 1)); // natural jitter
  });

  const osc = c.createOscillator();
  osc.type = s.type === "hiss" ? "sawtooth" : "triangle";
  pitch.forEach((f, i) => osc.frequency.setValueAtTime(f, t0 + (dur * i) / 127));

  // breath noise bed
  const noise = c.createBufferSource();
  const nb = c.createBuffer(1, Math.ceil(dur * c.sampleRate), c.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.15;
  noise.buffer = nb;

  // formant-ish coloration per vocal type
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = { meow: 1400, trill: 1800, chirp: 2200, hiss: 3000, bark: 900, yip: 1400, whine: 1100, cry: 1300, gurgle: 700 }[s.type] || 1200;
  bp.Q.value = { hiss: 0.7, bark: 2.5 }[s.type] || 4;

  const g = c.createGain();
  // amplitude envelope: fast attack, shaped sustain, soft release
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.05, dur * 0.2));
  g.gain.setValueAtTime(vol, t0 + dur * 0.75);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  const ng = c.createGain();
  ng.gain.setValueAtTime(vol * 0.35, t0);

  osc.connect(bp);
  noise.connect(ng).connect(bp);
  bp.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
  noise.start(t0);
  noise.stop(t0 + dur + 0.05);
  return dur;
}

export function playScript(script) {
  let at = 0;
  for (const s of script) {
    const d = playSyllable(s, at);
    at += d + 0.09;
  }
  return at;
}
