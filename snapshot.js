// Snapshot card — the uploaded media beside the character. When media is
// present the panel splits: character left 60%, this card in the right 40%
// (#character[data-media="on"]). A video plays in step with the sound, then
// freezes on the loudest-moment frame we sent to the model; a photo sits as
// a portrait. Removed with the × button (intent:media-clear) or media:clear.

const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mss = (sec) =>
  `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;

export function mount(el, stage) {
  let card = null;
  let mediaBox = null, cap1 = null, cap2 = null;
  let video = null;          // the playing clip, while the card shows video
  let kind = null;           // "video" | "photo"
  let finished = true;       // playback finished (or never needed)
  let frameSeen = false;     // a loudest-moment frame arrived
  let pendingFrame = null;   // media:frame that arrived before playback ended
  let playEndTimer = null;

  function ensureCard() {
    if (card) return;
    card = document.createElement("div");
    card.className = "snap";
    mediaBox = document.createElement("div");
    mediaBox.className = "snap-media";
    cap1 = document.createElement("div");
    cap1.className = "snap-cap";
    cap2 = document.createElement("div");
    cap2.className = "snap-sub";
    const x = document.createElement("button");
    x.className = "snap-x";
    x.textContent = "×";
    x.setAttribute("aria-label", "Remove picture");
    x.addEventListener("click", () => stage.emit("intent:media-clear"));
    card.append(mediaBox, cap1, cap2, x);
    el.appendChild(card);
    if (!RM) card.classList.add("snap-in");
  }

  function clearCard() {
    if (playEndTimer) { clearTimeout(playEndTimer); playEndTimer = null; }
    card?.remove();
    card = null;
    video = null;
    kind = null;
    pendingFrame = null;
    frameSeen = false;
    finished = true;
    delete el.dataset.media;
  }

  function setSub(sent, demo) {
    cap2.textContent = sent
      ? (kind === "photo" ? "sent with each sound" : "sent with the sound")
      : "shown only";
    if (demo && !sent) cap2.title = "This hosted demo has no live model";
    else cap2.removeAttribute("title");
  }

  function swapToFrame(d) {
    // Replace the playing clip with the frame we sent.
    const img = document.createElement("img");
    img.src = d.dataUrl;
    img.alt = "";
    mediaBox.replaceChildren(img);
    video = null;
    cap1.textContent = `${mss(d.sec)} · loudest moment`;
  }

  stage.on("capture:start", (d) => {
    if (d.source !== "file" || !video) return;
    finished = false;
    video.play?.().catch(() => {});
    playEndTimer = setTimeout(() => {
      finished = true;
      video?.pause?.();
      if (pendingFrame) { const d2 = pendingFrame; pendingFrame = null; swapToFrame(d2); }
      else if (!frameSeen) cap1.textContent = "your clip";
    }, d.durationMs || 0);
  });

  stage.on("media:set", (d) => {
    clearCard();
    ensureCard();
    kind = d.kind;
    el.dataset.media = "on";
    if (d.kind === "video") {
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.src = d.url;
      video.currentTime = d.fromSec || 0;
      mediaBox.replaceChildren(video);
      cap1.textContent = "playing";
      cap2.textContent = "";
    } else {
      const img = document.createElement("img");
      img.src = d.url;
      img.alt = "";
      mediaBox.replaceChildren(img);
      cap1.textContent = "portrait";
      cap2.textContent = "";
    }
  });

  stage.on("media:frame", (d) => {
    if (!card) return;
    setSub(d.sent, d.demo);
    if (d.tMs != null) {
      // video: the loudest-moment frame (or a failed grab, dataUrl null)
      if (!d.dataUrl) return; // keep the video's first frame
      frameSeen = true;
      const fr = { dataUrl: d.dataUrl, sec: (d.fromSec || 0) + d.tMs / 1000 };
      if (finished) swapToFrame(fr);
      else pendingFrame = fr;
    } else if (d.dataUrl && !mediaBox.querySelector("img")) {
      const img = document.createElement("img");
      img.src = d.dataUrl;
      img.alt = "";
      mediaBox.replaceChildren(img);
      video = null;
      cap1.textContent = "portrait";
    }
  });

  stage.on("media:clear", clearCard);
}
