const listeners = new Map();

export const SPECIES = {
  cat: { label: "Cat", persona: "aloof, judgemental, affectionate on its own terms", rangeHz: [400, 700] },
  dog: { label: "Dog", persona: "unguarded enthusiasm, every feeling at full volume", rangeHz: [250, 500] },
  infant: { label: "Infant", persona: "pure need, no subtext", rangeHz: [350, 450] },
};

export const STATES = ["boot", "idle", "listening", "analysing", "queued", "streaming", "done", "error"];

export const stage = {
  state: "boot",
  species: "cat",
  set(state, detail = {}) {
    if (!STATES.includes(state)) throw new Error("unknown state " + state);
    const prev = this.state;
    this.state = state;
    document.body.dataset.state = state;
    this.emit("state", { ...detail, state, prev });
  },
  setSpecies(id) {
    if (!SPECIES[id] || id === this.species) return;
    this.species = id;
    document.body.dataset.species = id;
    this.emit("species", { species: id });
  },
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  emit(type, detail = {}) {
    for (const fn of [...(listeners.get(type) || [])]) {
      try { fn(detail); } catch (e) { console.error(`[stage] listener for "${type}" threw`, e); }
    }
    for (const fn of [...(listeners.get("*") || [])]) {
      try { fn({ type, detail }); } catch (e) { console.error(e); }
    }
  },
};
