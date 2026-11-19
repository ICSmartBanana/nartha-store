// NARTHA motion: loom loader, needle-and-thread cursor, fabric page transitions, scroll reveals.
// Uses GSAP + ScrollTrigger (loaded in index.html). Everything degrades gracefully without them.
const g = window.gsap;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (g && window.ScrollTrigger) g.registerPlugin(window.ScrollTrigger);

const WEFT = ["#A23B2A", "#D9A441", "#24345A", "#2F6B5A", "#A23B2A", "#D9A441", "#24345A", "#B5532E"];

/* ---------- loom (used by the page loader and the try-on wait) ---------- */
export function loomSVG(size = 120, id = "") {
  const warps = Array.from({ length: 9 }, (_, i) => `<line class="warp" x1="${22 + i * 9.5}" y1="14" x2="${22 + i * 9.5}" y2="96"/>`).join("");
  return `<svg class="loom" ${id ? `id="${id}"` : ""} viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
    <rect x="12" y="8" width="96" height="6" rx="3" class="beam"/><rect x="12" y="96" width="96" height="6" rx="3" class="beam"/>
    <g class="warps">${warps}</g><g class="wefts"></g>
    <g class="shuttle"><path d="M0 0 h16 l4 3 -4 3 h-16 l-4 -3z" class="shuttle-body"/><circle cx="8" cy="3" r="1.4" class="shuttle-eye"/></g>
  </svg>`;
}
export function weave(svg, { rows = 9, rowTime = 0.32, loop = true } = {}) {
  if (!g || !svg) return { kill() {} };
  const wefts = svg.querySelector(".wefts"), shuttle = svg.querySelector(".shuttle");
  const tl = g.timeline({ repeat: loop ? -1 : 0, repeatDelay: 0.2 });
  g.set(svg.querySelectorAll(".warp"), { strokeDasharray: 82, strokeDashoffset: 82 });
  tl.to(svg.querySelectorAll(".warp"), { strokeDashoffset: 0, duration: 0.5, stagger: 0.04, ease: "power2.out" });
  for (let r = 0; r < rows; r++) {
    const y = 90 - r * 8.6, ltr = r % 2 === 0;
    tl.add(() => {
      const ln = document.createElementNS("http://www.w3.org/2000/svg", "path");
      ln.setAttribute("d", `M ${ltr ? 16 : 104} ${y} Q 60 ${y + (ltr ? 1.6 : -1.6)} ${ltr ? 104 : 16} ${y}`);
      ln.setAttribute("class", "weft"); ln.style.stroke = WEFT[r % WEFT.length];
      ln.style.strokeDasharray = 92; ln.style.strokeDashoffset = 92;
      wefts.appendChild(ln);
      g.to(ln, { strokeDashoffset: 0, duration: rowTime, ease: "none" });
    });
    tl.fromTo(shuttle, { x: ltr ? 4 : 96, y: y - 3 }, { x: ltr ? 96 : 4, duration: rowTime, ease: "power1.inOut" });
    tl.to(svg.querySelectorAll(".warp"), { x: (i) => (i % 2 === r % 2 ? 0.8 : -0.8), duration: 0.08 }, "<");
  }
  if (loop) tl.add(() => { g.to(wefts.children, { opacity: 0, duration: 0.25, onComplete: () => (wefts.innerHTML = "") }); }, "+=0.35");
  return tl;
}

/* ---------- page loader ---------- */
export function startLoader() {
  const el = document.getElementById("loader");
  if (!el) return () => {};
  el.querySelector(".loader-loom").innerHTML = loomSVG(132);
  const tl = weave(el.querySelector(".loom"), { rows: 9, rowTime: 0.16 });
  if (g) g.from(el.querySelectorAll(".loader-word span"), { yPercent: 110, stagger: 0.05, duration: 0.7, ease: "power3.out", delay: 0.3 });
  const t0 = performance.now();
  return () => {
    const wait = Math.max(0, (reduce ? 0 : 1500) - (performance.now() - t0));
    setTimeout(() => {
      if (!g) { el.remove(); return; }
      g.timeline({ onComplete: () => { tl.kill(); el.remove(); } })
        .to(el.querySelector(".loader-inner"), { y: -30, opacity: 0, duration: 0.45, ease: "power2.in" })
        .to(el.querySelectorAll(".loader-panel"), { yPercent: -100, stagger: 0.07, duration: 0.8, ease: "power4.inOut" }, "-=0.1");
    }, wait);
  };
}

/* ---------- needle & thread cursor (desktop only) ---------- */
export function initCursor() {
  if (!g || reduce || !matchMedia("(pointer: fine)").matches) return;
  document.documentElement.classList.add("has-cursor");
  const wrap = document.createElement("div");
  wrap.className = "cursor";
  wrap.innerHTML = `<svg class="thread" width="100%" height="100%"><path/></svg>
    <div class="needle"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 20 L18 6" class="n-body"/><ellipse cx="18.6" cy="5.4" rx="2.2" ry="1.1" transform="rotate(-45 18.6 5.4)" class="n-eye"/></svg></div>
    <div class="spool"><span></span></div>`;
  document.body.appendChild(wrap);
  const needle = wrap.querySelector(".needle"), spool = wrap.querySelector(".spool"), label = spool.querySelector("span"), path = wrap.querySelector(".thread path");
  const nx = g.quickTo(needle, "x", { duration: 0.12, ease: "power3" }), ny = g.quickTo(needle, "y", { duration: 0.12, ease: "power3" });
  const sx = g.quickTo(spool, "x", { duration: 0.35, ease: "power3" }), sy = g.quickTo(spool, "y", { duration: 0.35, ease: "power3" });
  const pts = Array.from({ length: 14 }, () => ({ x: -100, y: -100 }));
  let mx = -100, my = -100, idle = 0;
  addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; nx(mx); ny(my); sx(mx); sy(my); idle = 0; }, { passive: true });
  g.ticker.add(() => {
    idle++;
    pts[0].x += (mx - pts[0].x) * 0.55; pts[0].y += (my - pts[0].y) * 0.55;
    for (let i = 1; i < pts.length; i++) { pts[i].x += (pts[i - 1].x - pts[i].x) * 0.42; pts[i].y += (pts[i - 1].y - pts[i].y) * 0.42 + (idle > 20 ? 0.25 : 0); }
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) { const xc = (pts[i].x + pts[i + 1].x) / 2, yc = (pts[i].y + pts[i + 1].y) / 2; d += ` Q${pts[i].x} ${pts[i].y} ${xc} ${yc}`; }
    path.setAttribute("d", d);
  });
  const hoverSel = "a,button,[data-cursor],label,select,input";
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest(hoverSel); if (!t) return;
    const txt = t.closest("[data-cursor]")?.dataset.cursor || "";
    label.textContent = txt;
    wrap.classList.add("hover"); wrap.classList.toggle("labelled", !!txt);
  });
  document.addEventListener("pointerout", (e) => { if (e.target.closest(hoverSel) && !e.relatedTarget?.closest?.(hoverSel)) wrap.classList.remove("hover", "labelled"); });
  document.addEventListener("pointerdown", () => g.fromTo(spool, { scale: 0.8 }, { scale: 1, duration: 0.4, ease: "back.out(3)" }));
  document.addEventListener("mouseleave", () => g.to(wrap, { opacity: 0, duration: 0.2 }));
  document.addEventListener("mouseenter", () => g.to(wrap, { opacity: 1, duration: 0.2 }));
}

/* ---------- route transition: a woven panel sweeps across ---------- */
export function fabricSwipe(swap) {
  const el = document.getElementById("swipe");
  if (!g || reduce || !el) { swap(); return; }
  g.timeline()
    .set(el, { display: "block" })
    .fromTo(el.children, { xPercent: -101 }, { xPercent: 0, duration: 0.42, stagger: 0.05, ease: "power3.in" })
    .add(swap)
    .to(el.children, { xPercent: 101, duration: 0.5, stagger: 0.05, ease: "power3.out" })
    .set(el, { display: "none" });
}

/* ---------- per-page motion ---------- */
let triggers = [];
export function animatePage(root) {
  triggers.forEach((t) => t.kill()); triggers = [];
  if (!g) return;
  if (reduce) { g.set(root.querySelectorAll("[data-reveal],[data-unveil]"), { clearProps: "all", opacity: 1 }); return; }
  const ST = window.ScrollTrigger;
  root.querySelectorAll("[data-reveal]").forEach((el) => {
    const kids = el.dataset.reveal === "stagger" ? el.children : [el];
    const tw = g.from(kids, { y: 34, opacity: 0, duration: 0.9, stagger: 0.08, ease: "power3.out",
      scrollTrigger: ST ? { trigger: el, start: "top 88%", once: true } : undefined });
    tw.scrollTrigger && triggers.push(tw.scrollTrigger);
  });
  root.querySelectorAll("[data-unveil]").forEach((el) => {
    const tw = g.fromTo(el, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", duration: 1.15, ease: "power4.inOut",
      scrollTrigger: ST ? { trigger: el, start: "top 90%", once: true } : undefined });
    tw.scrollTrigger && triggers.push(tw.scrollTrigger);
  });
  root.querySelectorAll(".thread-rule path").forEach((p) => {
    const len = p.getTotalLength(); g.set(p, { strokeDasharray: len, strokeDashoffset: len });
    const tw = g.to(p, { strokeDashoffset: 0, ease: "none", scrollTrigger: ST ? { trigger: p.closest("svg"), start: "top 95%", end: "top 45%", scrub: 0.6 } : undefined });
    tw.scrollTrigger && triggers.push(tw.scrollTrigger);
  });
  root.querySelectorAll("[data-parallax]").forEach((el) => {
    const tw = g.to(el, { yPercent: +el.dataset.parallax || -10, ease: "none", scrollTrigger: ST ? { trigger: el.parentElement, scrub: true } : undefined });
    tw.scrollTrigger && triggers.push(tw.scrollTrigger);
  });
  root.querySelectorAll(".marquee-track").forEach((t) => {
    const tw = g.to(t, { xPercent: -50, duration: 28, ease: "none", repeat: -1 });
    triggers.push({ kill: () => tw.kill() });
  });
  const h = root.querySelector(".page-title");
  if (h) g.from(h, { y: 40, opacity: 0, duration: 0.9, ease: "power3.out", delay: 0.15 });
  ST && ST.refresh();
}

/* ---------- hero slideshow ---------- */
export function heroSlideshow(root) {
  const slides = [...root.querySelectorAll(".slide")], bars = [...root.querySelectorAll(".slide-bar i")];
  if (!slides.length) return;
  let i = 0, timer;
  const show = (n) => {
    const prev = slides[i]; i = (n + slides.length) % slides.length; const cur = slides[i];
    slides.forEach((s) => s.classList.toggle("on", s === cur));
    if (g && !reduce) {
      if (prev !== cur) g.to(prev, { opacity: 0, duration: 1.1, ease: "power2.inOut" });
      g.fromTo(cur, { opacity: 0 }, { opacity: 1, duration: 1.1, ease: "power2.inOut" });
      g.fromTo(cur.querySelector("img"), { scale: 1.12 }, { scale: 1, duration: 6.5, ease: "none" });
      bars.forEach((b, k) => g.set(b, { scaleX: k < i ? 1 : 0 }));
      g.fromTo(bars[i], { scaleX: 0 }, { scaleX: 1, duration: 5.5, ease: "none" });
    } else slides.forEach((s) => (s.style.opacity = s === cur ? 1 : 0));
    clearTimeout(timer); timer = setTimeout(() => root.isConnected && show(i + 1), 5500);
  };
  root.querySelectorAll("[data-slide]").forEach((b) => (b.onclick = () => show(+b.dataset.slide)));
  show(0);
  if (g && !reduce) g.from(root.querySelectorAll(".hero-copy > *"), { y: 40, opacity: 0, stagger: 0.1, duration: 1, ease: "power3.out", delay: 0.2 });
}

/* ---------- before/after slider ---------- */
export function beforeAfter(el) {
  if (!el) return;
  const set = (p) => { p = Math.max(0, Math.min(100, p)); el.style.setProperty("--pos", p + "%"); el.querySelector(".ba-handle")?.setAttribute("aria-valuenow", Math.round(p)); };
  const at = (e) => { const r = el.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100); };
  let drag = false;
  el.addEventListener("pointerdown", (e) => { drag = true; el.setPointerCapture(e.pointerId); at(e); intro?.kill(); });
  el.addEventListener("pointermove", (e) => drag && at(e));
  el.addEventListener("pointerup", () => (drag = false));
  el.querySelector(".ba-handle")?.addEventListener("keydown", (e) => {
    const cur = parseFloat(getComputedStyle(el).getPropertyValue("--pos")) || 50;
    if (e.key === "ArrowLeft") set(cur - 5); if (e.key === "ArrowRight") set(cur + 5);
  });
  let intro;
  if (g && !reduce) {
    const o = { p: 92 };
    intro = g.timeline({ scrollTrigger: window.ScrollTrigger ? { trigger: el, start: "top 70%", once: true } : undefined })
      .to(o, { p: 8, duration: 1.6, ease: "power2.inOut", onUpdate: () => set(o.p) })
      .to(o, { p: 50, duration: 1.1, ease: "power2.inOut", onUpdate: () => set(o.p) });
  } else set(50);
}

/* ---------- small delights ---------- */
export function flyToBag(fromEl, imgSrc) {
  const bag = document.querySelector(".bag-btn");
  if (!g || reduce || !fromEl || !bag) return;
  const a = fromEl.getBoundingClientRect(), b = bag.getBoundingClientRect();
  const ghost = document.createElement("img");
  ghost.src = imgSrc; ghost.className = "fly";
  Object.assign(ghost.style, { left: a.left + a.width / 2 - 28 + "px", top: a.top - 20 + "px" });
  document.body.appendChild(ghost);
  g.timeline({ onComplete: () => ghost.remove() })
    .to(ghost, { x: b.left - a.left - a.width / 2 + 36, duration: 0.8, ease: "power1.inOut" }, 0)
    .to(ghost, { y: b.top - a.top + 16, duration: 0.8, ease: "back.in(1.4)" }, 0)
    .to(ghost, { scale: 0.25, rotate: 20, opacity: 0.6, duration: 0.8 }, 0)
    .fromTo(bag, { scale: 1 }, { scale: 1.25, duration: 0.18, yoyo: true, repeat: 1 }, 0.72);
}
export function pop(el) { if (g && el && !reduce) g.fromTo(el, { scale: 0.92 }, { scale: 1, duration: 0.5, ease: "back.out(3)" }); }
