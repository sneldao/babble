import { unlock } from "../audio.js";
import { SPECIES } from "../stage.js";

const CLIPS = [
  { file: "cat-pleading.wav", species: "cat", label: "cat · pleading" },
  { file: "cat-meow.wav", species: "cat", label: "cat · meow" },
  { file: "cat-meows2.wav", species: "cat", label: "cat · meow run" },
  { file: "dog-bark.wav", species: "dog", label: "dog · bark" },
  { file: "dog-bark2.wav", species: "dog", label: "dog · bark volley" },
];

export function mount(el, stage) {
  const bar = document.createElement("div");
  bar.id = "intentBar";
  bar.className = "dev-panel";

  let race = false;
  let cam = false;
  let unlocked = false;
  const press = (fn) => async () => {
    if (!unlocked) { unlocked = true; unlock(); }
    fn();
  };

  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", press(fn));
    bar.appendChild(b);
    return b;
  };

  btn("Listen 3s", () => stage.emit("intent:listen", { secs: 3 }));
  for (const c of CLIPS) btn(c.label, () => stage.emit("intent:clip", { file: c.file, species: c.species }));
  const raceBtn = btn("Race off", () => {
    race = !race;
    raceBtn.textContent = race ? "Race on" : "Race off";
    stage.emit("intent:race", { on: race });
  });
  const camBtn = btn("Cam off", () => {
    cam = !cam;
    camBtn.textContent = cam ? "Cam on" : "Cam off";
    stage.emit("intent:cam", { on: cam });
  });
  btn("Retry", () => stage.emit("intent:retry", {}));

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "say something back…";
  bar.appendChild(input);
  const send = () => {
    if (input.value.trim()) stage.emit("intent:reply", { text: input.value.trim() });
    input.value = "";
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") press(send)(); });
  btn("Send", send);

  for (const [id, s] of Object.entries(SPECIES)) btn(s.label, () => stage.setSpecies(id));

  el.appendChild(bar);
}
