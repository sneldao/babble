// Drop zone — a file dragged anywhere over the stage gets the sheet.
// Inactive while the app is booting or busy (the intent:file guard is the
// second line of defence). A depth counter keeps the overlay from sticking
// as the drag crosses child elements.

const BUSY = ["boot", "listening", "analysing", "queued", "streaming"];

export function mount(stage) {
  let overlay = null;
  let depth = 0;

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

  function show() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "dropz";
    for (const c of ["tl", "tr", "bl", "br"]) {
      const i = document.createElement("i");
      i.className = `dropz-c ${c}`;
      overlay.appendChild(i);
    }
    const big = document.createElement("div");
    big.className = "dropz-big";
    big.textContent = "Drop it here";
    const sub = document.createElement("div");
    sub.className = "dropz-sub";
    sub.textContent = "a video, a sound, or a photo of your pet";
    overlay.append(big, sub);
    document.body.appendChild(overlay);
  }

  function hide() {
    overlay?.remove();
    overlay = null;
    depth = 0;
  }

  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (BUSY.includes(stage.state)) return;
    depth++;
    if (depth === 1) show();
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // allow the drop
  });
  window.addEventListener("dragleave", (e) => {
    if (!overlay) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) hide();
  });
  window.addEventListener("dragend", () => { if (overlay) hide(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    const wasOpen = !!overlay;
    hide();
    if (wasOpen && file) stage.emit("intent:file", { file });
  });
}
