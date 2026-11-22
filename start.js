// Start screen — Dev D (docs/redesign/dev-d-captions.md §2).
// Modal dialog shown while state is boot; unlocks audio on first gesture.
// Shape follows thibautlfr/ocarina src/experience/ui/title-screen.ts (MIT):
// loading gauge → start button, per-pointer labels, key legend, sound note.

import { unlock } from "./audio.js";
import { mount as mountChar } from "./character.js";
import { gooSeg } from "./goo.js";

export function mount(el, st) {
  el.innerHTML = "";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const dlg = document.createElement("div");
  dlg.className = "start-dialog";
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-modal", "true");
  dlg.setAttribute("aria-labelledby", "startTitle");

  const mark = document.createElement("h1");
  mark.id = "startTitle";
  mark.className = "start-mark";
  mark.textContent = "Babble";
  const dot = document.createElement("i");
  dot.textContent = ".";
  mark.appendChild(dot);

  const line = document.createElement("p");
  line.className = "start-line";
  line.textContent = "Point a mic at your pet. Babble measures the sound and tells you what it meant.";

  const chips = document.createElement("div");
  chips.className = "start-chips";
  const chipsGoo = gooSeg(chips);
  function reflectChips(sp) {
    for (const c of chips.querySelectorAll("[data-sp]")) c.setAttribute("aria-pressed", String(c.dataset.sp === sp));
    chips.style.setProperty("--goo-color", `color-mix(in srgb, var(--${sp}) 24%, var(--paper))`);
    const b = chips.querySelector(`[data-sp="${sp}"]`);
    if (b) chipsGoo.moveTo(b);
  }
  for (const sp of ["cat", "dog", "infant"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "start-chip";
    b.dataset.sp = sp;
    b.textContent = sp;
    b.setAttribute("aria-pressed", String(st.species === sp));
    b.addEventListener("click", () => st.setSpecies(sp));
    chips.appendChild(b);
  }
  reflectChips(st.species);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "start-btn";
  btn.disabled = true;
  btn.textContent = "Loading…";

  const legend = document.createElement("div");
  legend.className = "start-legend";
  legend.textContent = "Space listen · 1 2 3 species · R race · M mute · L log";
  const sound = document.createElement("div");
  sound.className = "start-sound";
  sound.textContent = "Sound on";

  const pane = document.createElement("div");
  pane.className = "start-pane";
  pane.setAttribute("aria-hidden", "true");
  dlg.append(mark, line, chips, btn, legend, sound, pane);
  el.appendChild(dlg);
  const charTeardown = mountChar(pane, st);

  const coarse = matchMedia("(pointer: coarse)").matches;
  Promise.allSettled([document.fonts.ready, fetch("/api/config")]).then(() => {
    btn.disabled = false;
    btn.textContent = coarse ? "Tap to start" : "Press Space to start";
    btn.focus();
  });

  let gone = false;
  function start() {
    if (gone || btn.disabled) return;
    gone = true;
    unlock();
    st.emit("intent:start");
    dlg.classList.add("out");
    dlg.setAttribute("inert", "");
    charTeardown?.();
    pane.remove();
    if (RM) dlg.style.display = "none";
    else setTimeout(() => { dlg.style.display = "none"; }, 900);
  }
  btn.addEventListener("click", start);

  const unsubs = [
    st.on("species", ({ species }) => reflectChips(species)),
  ];
  return () => unsubs.forEach((u) => u());
}
