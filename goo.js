// Gooey active-pill for segmented controls — used by controls.js and start.js.
// Technique adapted from codrops/GooeyStickyMenu (MIT): an SVG "goo" filter
// (feGaussianBlur + a feColorMatrix alpha ramp) merges a moving pill and a
// lagging trail dot so the indicator stretches like liquid between options.
// The motion is the ferro-toggle spring integrator (MIT, argofowl).

let defsAdded = false;
function ensureDefs() {
  if (defsAdded) return;
  defsAdded = true;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0";
  svg.innerHTML =
    '<defs><filter id="babble-goo">' +
    '<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/>' +
    '<feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"/>' +
    "</filter></defs>";
  document.body.appendChild(svg);
}

// ferro-toggle spring integrator (MIT)
function spring(s, target, w, z, dt) {
  s.v += (-w * w * (s.x - target) - 2 * z * w * s.v) * dt;
  s.x += s.v * dt;
}

// wrap: a container whose children are the segment buttons (marked with
// [data-sp] or any attribute). Returns { moveTo, refresh, destroy }.
// moveTo(btn) slides the goo indicator under btn; refresh() re-measures the
// current target (call after fonts load or layout changes).
export function gooSeg(wrap) {
  ensureDefs();
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  wrap.classList.add("goo-seg");
  const layer = document.createElement("div");
  layer.className = "goo-layer";
  const trail = document.createElement("i");
  trail.className = "goo-trail";
  const pill = document.createElement("i");
  pill.className = "goo-pill";
  layer.append(trail, pill);
  wrap.prepend(layer);

  const INSET = 3; // px; the pill hugs the inside of the segment border
  const pillS = { x: 0, v: 0 };
  const trailS = { x: 0, v: 0 };
  let target = null, box = null;
  let tgtPill = 0, tgtTrail = 0, trailH = 0;
  let raf = 0, last = 0, shown = false;

  function measure(el) {
    const wr = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height };
  }

  function paint() {
    if (!box) return;
    const h = box.h - INSET * 2;
    const y = box.y + INSET;
    pill.style.transform = `translate3d(${pillS.x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    pill.style.width = `${(box.w - INSET * 2).toFixed(1)}px`;
    pill.style.height = `${h.toFixed(1)}px`;
    trail.style.transform = `translate3d(${trailS.x.toFixed(1)}px, ${(y + (h - trailH) / 2).toFixed(1)}px)`;
    trail.style.width = trail.style.height = `${trailH.toFixed(1)}px`;
  }

  function aim() {
    const h = box.h - INSET * 2;
    trailH = Math.min(h * 0.52, 13);
    tgtPill = box.x + INSET;
    tgtTrail = box.x + box.w / 2 - trailH / 2;
  }

  function tick(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    spring(pillS, tgtPill, 17, 0.34, dt); // visible travel, slight overshoot
    spring(trailS, tgtTrail, 8, 0.52, dt); // well behind → the goo stretch
    paint();
    const settled =
      Math.abs(pillS.x - tgtPill) < 0.15 && Math.abs(pillS.v) < 0.5 &&
      Math.abs(trailS.x - tgtTrail) < 0.15 && Math.abs(trailS.v) < 0.5;
    if (settled) {
      pillS.x = tgtPill; trailS.x = tgtTrail; pillS.v = trailS.v = 0;
      paint();
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  function moveTo(el, { instant = false } = {}) {
    target = el;
    const b = measure(el);
    if (b.w <= 0 || b.h <= 0) return; // not laid out yet — refresh() will find it
    box = b;
    aim();
    if (instant || RM || !shown) {
      pillS.x = tgtPill; trailS.x = tgtTrail; pillS.v = trailS.v = 0;
      paint();
      if (!shown) { shown = true; layer.classList.add("on"); }
      return;
    }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function refresh() {
    if (target && target.isConnected) moveTo(target, { instant: true });
  }

  const ro = new ResizeObserver(refresh);
  ro.observe(wrap);
  document.fonts?.ready.then(refresh);

  return {
    moveTo,
    refresh,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      layer.remove();
    },
  };
}
