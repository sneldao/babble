// Controls — Dev D (docs/redesign/dev-d-captions.md §3).
// Emits intents only. Sample menu and More sheet are position:fixed so the
// stage's overflow cannot clip them. Race switch thumb uses the ferro-toggle
// spring integrator (MIT, argofowl).

import { setMuted } from "./sfx.js";

const SAMPLES = [
  ["cat-pleading.wav", "cat", "Cat · pleading meow"],
  ["cat-meow.wav", "cat", "Cat · single meow"],
  ["cat-meows2.wav", "cat", "Cat · run of meows"],
  ["dog-bark.wav", "dog", "Dog · barking"],
  ["dog-bark2.wav", "dog", "Dog · bark volley"],
];
const BUSY = ["listening", "analysing", "queued", "streaming"];

// ferro-toggle spring integrator (MIT)
function spring(s, target, w, z, dt) {
  s.v += (-w * w * (s.x - target) - 2 * z * w * s.v) * dt;
  s.x += s.v * dt;
}

export function mount(el, st) {
  el.innerHTML = "";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dur = 3;
  let replyReady = false;
  let sending = false;
  let menuOpen = false;
  let sheetOpen = false;
  let muted = false;
  let camOn = false;
  let raceOn = false;

  const B = (cls, label, attrs = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    return b;
  };

  // ---------- main row ----------
  const main = document.createElement("div");
  main.className = "ctl-main";

  const gListen = document.createElement("div");
  gListen.className = "ctl-group";
  const listen = B("ctl-listen", "Listen");
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("viewBox", "0 0 40 40");
  ring.classList.add("ctl-ring");
  const ringC = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringC.setAttribute("cx", "20"); ringC.setAttribute("cy", "20"); ringC.setAttribute("r", "17");
  ring.appendChild(ringC);
  listen.appendChild(ring);

  const durWrap = document.createElement("div");
  durWrap.className = "ctl-seg ctl-dur";
  durWrap.setAttribute("role", "group");
  durWrap.setAttribute("aria-label", "Listen duration");
  for (const s of [2, 3, 5]) {
    const b = B("ctl-segbtn", `${s} s`, { "aria-pressed": String(s === dur) });
    b.dataset.secs = s;
    b.addEventListener("click", () => {
      dur = s;
      for (const c of durWrap.children) c.setAttribute("aria-pressed", String(c === b));
    });
    durWrap.appendChild(b);
  }
  gListen.append(listen, durWrap);

  const gSource = document.createElement("div");
  gSource.className = "ctl-group";
  const sampleBtn = B("ctl-btn", "Sample", { "aria-haspopup": "menu", "aria-expanded": "false", title: "Try a sample" });
  const uploadBtn = B("ctl-btn", "Upload", { title: "Upload a clip" });
  const fileIn = document.createElement("input");
  fileIn.type = "file";
  fileIn.accept = "audio/*";
  fileIn.hidden = true;
  const camBtn = B("ctl-btn", "Cam", { "aria-pressed": "false", title: "Camera" });
  gSource.append(sampleBtn, uploadBtn, fileIn, camBtn);

  const gOpts = document.createElement("div");
  gOpts.className = "ctl-group";
  const spWrap = document.createElement("div");
  spWrap.className = "ctl-seg ctl-species";
  spWrap.setAttribute("role", "group");
  spWrap.setAttribute("aria-label", "Species");
  for (const sp of ["cat", "dog", "infant"]) {
    const b = B("ctl-segbtn", sp, { "aria-pressed": String(st.species === sp) });
    b.dataset.sp = sp;
    b.addEventListener("click", () => st.setSpecies(sp));
    spWrap.appendChild(b);
  }
  const raceBtn = B("ctl-switch", "", { role: "switch", "aria-checked": "false", "aria-label": "Race a GPU" });
  const raceTrack = document.createElement("span");
  raceTrack.className = "ctl-switch-track";
  const raceThumb = document.createElement("span");
  raceThumb.className = "ctl-switch-thumb";
  raceTrack.appendChild(raceThumb);
  const raceLbl = document.createElement("span");
  raceLbl.textContent = "Race a GPU";
  raceBtn.append(raceTrack, raceLbl);
  const muteBtn = B("ctl-btn", "Mute", { "aria-pressed": "false" });
  const petWrap = document.createElement("label");
  petWrap.className = "ctl-pet";
  const petLbl = document.createElement("span");
  petLbl.className = "ctl-pet-lbl";
  petLbl.textContent = "Pet name";
  const petIn = document.createElement("input");
  petIn.className = "ctl-input ctl-pet-in";
  petIn.setAttribute("aria-label", "Pet name");
  petIn.size = 9;
  petIn.maxLength = 32;
  petIn.autocomplete = "off";
  petWrap.append(petLbl, petIn);
  gOpts.append(spWrap, raceBtn, muteBtn, petWrap);

  main.append(gListen, gSource, gOpts);

  // ---------- reply row ----------
  const replyRow = document.createElement("div");
  replyRow.className = "ctl-reply";
  const replyIn = document.createElement("input");
  replyIn.className = "ctl-input";
  replyIn.size = 3; // keeps the row's min-content small enough for one-row layouts
  replyIn.placeholder = "Say something back…";
  replyIn.disabled = true;
  replyIn.title = "Translate a sound first";
  const sendBtn = B("ctl-send", "Send");
  sendBtn.disabled = true;
  sendBtn.title = "Translate a sound first";
  replyRow.append(replyIn, sendBtn);

  // ---------- mobile bar + more sheet ----------
  const bar = document.createElement("div");
  bar.className = "ctl-bar";
  const mListen = B("ctl-listen ctl-listen-m", "Listen");
  const mSample = B("ctl-btn", "Sample");
  const mMore = B("ctl-btn", "More", { "aria-haspopup": "dialog", "aria-expanded": "false" });
  bar.append(mListen, mSample, mMore);

  const sheet = document.createElement("div");
  sheet.className = "ctl-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "More controls");
  sheet.hidden = true;
  const sheetIn = document.createElement("div");
  sheetIn.className = "ctl-sheet-in";
  const sheetTitle = document.createElement("div");
  sheetTitle.className = "ctl-sheet-title";
  sheetTitle.textContent = "More";
  const sheetClose = B("ctl-btn", "Close");
  sheetIn.append(sheetTitle, durWrap.cloneNode(false), sheetClose);
  sheet.appendChild(sheetIn);
  // real controls live inside the sheet on mobile (moved, not cloned)
  const sheetBody = document.createElement("div");
  sheetBody.className = "ctl-sheet-body";
  sheetIn.insertBefore(sheetBody, sheetClose);

  // ---------- sample menu ----------
  const menu = document.createElement("div");
  menu.className = "ctl-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  for (const [file, species, label] of SAMPLES) {
    const it = B("ctl-menuitem", label, { role: "menuitem" });
    it.addEventListener("click", () => { closeMenu(); st.emit("intent:clip", { file, species }); });
    menu.appendChild(it);
  }

  el.append(main, replyRow, bar, sheet, menu);

  // ---------- behaviour ----------
  function placeFixed(node, anchor) {
    const r = anchor.getBoundingClientRect();
    node.style.left = Math.max(8, Math.min(r.left, innerWidth - 240)) + "px";
    const mh = node.offsetHeight || 260;
    node.style.top = (r.bottom + 6 + mh > innerHeight - 8 ? Math.max(8, r.top - 6 - mh) : r.bottom + 6) + "px";
  }
  function openMenu(anchor) {
    menu.hidden = false;
    placeFixed(menu, anchor);
    menuOpen = true;
    sampleBtn.setAttribute("aria-expanded", "true");
    menu.querySelector(".ctl-menuitem")?.focus();
  }
  function closeMenu() {
    menu.hidden = true;
    menuOpen = false;
    sampleBtn.setAttribute("aria-expanded", "false");
  }
  function openSheet() {
    sheet.hidden = false;
    sheetBody.append(durWrap, uploadBtn, camBtn, spWrap, raceBtn, muteBtn, petWrap);
    sheetOpen = true;
    mMore.setAttribute("aria-expanded", "true");
  }
  function closeSheet() {
    sheet.hidden = true;
    sheetOpen = false;
    gListen.append(durWrap);
    gSource.append(uploadBtn, camBtn);
    gOpts.append(spWrap, raceBtn, muteBtn, petWrap);
    mMore.setAttribute("aria-expanded", "false");
  }

  sampleBtn.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu(sampleBtn)));
  mSample.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu(mSample)));
  mMore.addEventListener("click", () => (sheetOpen ? closeSheet() : openSheet()));
  sheetClose.addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll(".ctl-menuitem")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { closeMenu(); sampleBtn.focus(); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (menuOpen && !menu.contains(e.target) && e.target !== sampleBtn && e.target !== mSample) closeMenu();
  });

  uploadBtn.addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", () => {
    if (fileIn.files[0]) st.emit("intent:file", { file: fileIn.files[0] });
    fileIn.value = "";
  });
  camBtn.addEventListener("click", () => { camOn = !camOn; camBtn.setAttribute("aria-pressed", String(camOn)); st.emit("intent:cam", { on: camOn }); });
  muteBtn.addEventListener("click", toggleMute);
  function toggleMute() {
    muted = !muted;
    setMuted(muted);
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.textContent = muted ? "Unmute" : "Mute";
  }

  function doListen() { st.emit("intent:listen", { secs: dur }); }
  listen.addEventListener("click", doListen);
  mListen.addEventListener("click", doListen);

  // race switch with sprung thumb
  const thumb = { x: 0, v: 0 };
  let thumbRaf = 0, thumbLast = 0;
  function thumbTo(target) {
    if (RM) { thumb.x = target; raceThumb.style.transform = `translateX(${target}px)`; return; }
    if (thumbRaf) return;
    thumbLast = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - thumbLast) / 1000);
      thumbLast = now;
      spring(thumb, target, 22, 0.34, dt);
      raceThumb.style.transform = `translateX(${thumb.x}px)`;
      if (Math.abs(thumb.x - target) < 0.05 && Math.abs(thumb.v) < 0.05) {
        thumb.x = target;
        raceThumb.style.transform = `translateX(${target}px)`;
        thumbRaf = 0;
        return;
      }
      thumbRaf = requestAnimationFrame(tick);
    };
    thumbRaf = requestAnimationFrame(tick);
  }
  const THUMB_X = 22;
  function toggleRace(on) {
    raceOn = on ?? !raceOn;
    raceBtn.setAttribute("aria-checked", String(raceOn));
    raceBtn.classList.toggle("on", raceOn);
    thumbTo(raceOn ? THUMB_X : 0);
    st.emit("intent:race", { on: raceOn });
  }
  raceBtn.addEventListener("click", () => toggleRace());

  let replyHadFocus = false;
  function sendReply() {
    const text = replyIn.value.trim();
    if (!text || sending) return;
    replyHadFocus = document.activeElement === replyIn;
    sending = true;
    replyIn.value = "";
    sendBtn.textContent = "Sending…";
    sendBtn.disabled = true;
    replyIn.disabled = true;
    st.emit("intent:reply", { text });
  }
  sendBtn.addEventListener("click", sendReply);
  replyIn.addEventListener("keydown", (e) => { if (e.key === "Enter") sendReply(); });

  // ---------- state reflection ----------
  function reflect() {
    const busy = BUSY.includes(st.state);
    listen.disabled = busy;
    mListen.disabled = busy;
    sampleBtn.disabled = busy;
    mSample.disabled = busy;
    if (st.state === "listening") { listen.classList.add("on"); listen.firstChild.textContent = "Listening…"; }
    else { listen.classList.remove("on"); listen.firstChild.textContent = "Listen"; }
    if (!sending) {
      replyIn.disabled = !replyReady;
      sendBtn.disabled = !replyReady;
      const t = replyReady ? "" : "Translate a sound first";
      replyIn.title = t;
      sendBtn.title = t;
    }
  }
  const petNarrow = matchMedia("(min-width: 1200px) and (max-width: 1599.98px)");
  petNarrow.addEventListener?.("change", reflectSpecies);
  function reflectSpecies() {
    for (const c of spWrap.children) c.setAttribute("aria-pressed", String(c.dataset.sp === st.species));
    // The visible "PET NAME" label hides below 1600px; keep the field
    // identifiable via its placeholder there.
    petIn.placeholder = petNarrow.matches ? "Pet name" : st.species[0].toUpperCase() + st.species.slice(1);
    petIn.value = localStorage.getItem(`babble.pet.${st.species}`) || "";
  }
  function sendPet() {
    st.emit("intent:pet", { name: petIn.value.trim() });
  }
  petIn.addEventListener("change", sendPet);
  petIn.addEventListener("keydown", (e) => { if (e.key === "Enter") sendPet(); e.stopPropagation(); });

  const RING_LEN = 2 * Math.PI * 17;
  ringC.style.strokeDasharray = String(RING_LEN);
  ringC.style.strokeDashoffset = String(RING_LEN);
  let ringAnim = null;

  const unsubs = [
    st.on("state", reflect),
    st.on("species", reflectSpecies),
    st.on("capture:start", (d) => {
      if (!d.durationMs || RM) return;
      ringAnim?.cancel();
      ringC.style.strokeDashoffset = String(RING_LEN);
      ringAnim = ringC.animate(
        [{ strokeDashoffset: RING_LEN }, { strokeDashoffset: 0 }],
        { duration: d.durationMs, fill: "forwards", easing: "linear" }
      );
    }),
    st.on("interpret:done", (d) => {
      if (d.lane !== "cerebras") return;
      replyReady = true;
      sending = false;
      sendBtn.textContent = "Send";
      reflect();
    }),
    st.on("vocalize:play", () => {
      sending = false;
      sendBtn.textContent = "Send";
      replyIn.disabled = false;
      sendBtn.disabled = false;
      if (replyHadFocus) replyIn.focus();
    }),
    st.on("vocalize:error", () => {
      sending = false;
      sendBtn.textContent = "Send";
      replyIn.disabled = false;
      sendBtn.disabled = false;
      if (replyHadFocus) replyIn.focus();
    }),
  ];

  // ---------- keys ----------
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable;
    if (e.key === "Escape" && (menuOpen || sheetOpen)) { closeMenu(); closeSheet(); return; }
    if (typing || menuOpen || sheetOpen) return;
    const k = e.key.toLowerCase();
    if (e.key === " " && ["idle", "done", "error"].includes(st.state)) { e.preventDefault(); doListen(); }
    else if (k === "1") st.setSpecies("cat");
    else if (k === "2") st.setSpecies("dog");
    else if (k === "3") st.setSpecies("infant");
    else if (k === "r") toggleRace();
    else if (k === "m") toggleMute();
  });

  reflect();
  reflectSpecies();
  return () => unsubs.forEach((u) => u());
}
