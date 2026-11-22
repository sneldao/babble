import { stage } from "./stage.js";
import { mount as mountRibbon } from "./ribbon.js";
import { mount as mountTelemetry } from "./telemetry.js";
import { mount as mountCharacter } from "./character.js";
import { mount as mountCaptions } from "./captions.js";
import { mount as mountStart } from "./start.js";
import { mount as mountControls } from "./controls.js";

mountRibbon(document.getElementById("ribbon"), stage);
mountTelemetry(document.getElementById("telemetry"), stage);
mountCharacter(document.getElementById("character"), stage);
mountCaptions(document.getElementById("captions"), stage);
mountStart(document.getElementById("start"), stage);
mountControls(document.getElementById("controls"), stage);

try {
  const cfg = await (await fetch("/api/config")).json();
  document.getElementById("engine").textContent = `${cfg.model} · OpenClaw on Cerebras`;
} catch {
  document.getElementById("engine").textContent = "engine offline";
}

const startEl = document.getElementById("start");
if (!startEl.children.length) stage.set("idle");
stage.on("intent:start", () => {
  if (stage.state === "boot") stage.set("idle");
});

const log = document.getElementById("log");
const logList = document.getElementById("logList");
const logToggle = document.getElementById("logToggle");

function toggleLog() {
  const open = log.classList.toggle("open");
  logToggle.setAttribute("aria-expanded", String(open));
}
logToggle.addEventListener("click", toggleLog);
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "l" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
  toggleLog();
});

stage.on("interpret:done", (d) => {
  if (d.lane !== "cerebras") return;
  const li = document.createElement("li");
  li.textContent = `${stage.species} · ${d.text}${d.replay ? " (replay)" : ""}`;
  logList.appendChild(li);
});
stage.on("reply:sent", (d) => {
  const li = document.createElement("li");
  li.textContent = `you · ${d.text}`;
  logList.appendChild(li);
});

// TODO(next handoff): intent handlers — intent:listen, intent:clip, intent:file,
// intent:reply, intent:race, intent:cam, intent:retry (see README events table)

if (new URLSearchParams(location.search).has("dev")) {
  const { mount } = await import("./dev/intent-bar.js");
  mount(document.body, stage);
}
