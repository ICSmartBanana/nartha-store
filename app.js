import { CONFIG } from "./config.js";
import { startLoader, initCursor, fabricSwipe, animatePage, heroSlideshow, beforeAfter, flyToBag, pop, loomSVG, weave } from "./anim.js";

const finishLoader = startLoader();

// Supabase is only loaded when someone uses try-on (keeps the shop fast).
let _sb;
async function getSb() {
  if (_sb) return _sb;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.4");
  _sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" },
  });
  _sb.auth.onAuthStateChange((ev) => {
    const back = sessionStorage.getItem("nartha_after_login");
    if (ev === "SIGNED_IN" && back) {
      sessionStorage.removeItem("nartha_after_login");
      const h = back.match(/#\/p\/([^?]+)\?try/);
      if (h) setTimeout(() => openTryOn(decodeURIComponent(h[1])), 400);
    }
  });
  return _sb;
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const img = (u, w = 800) => (u ? u + (u.includes("?") ? "&" : "?") + "width=" + w : "");
const app = $("#app");

let DATA = { collections: [], products: [] }, POLICIES = {};
const byHandle = new Map();

/* ---------- catalog ---------- */
async function loadCatalog() {
  const [c, p] = await Promise.all([
    fetch("data/catalog.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/policies.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({})),
  ]);
  DATA = c; POLICIES = p;
  DATA.collections.forEach((c) => (c.title = c.title.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim()));
  DATA.products.forEach((p) => byHandle.set(p.handle, p));
}
const colTitle = (h) => DATA.collections.find((c) => c.handle === h)?.title ?? "";
const shortCol = (t) => t.replace(/\s*-\s*The Festive Weaves/i, "").replace(/ Collection$/i, "");
const kindOf = (p) => (p.type || "").replace(/Chetttinadu/i, "Chettinad").replace(/Special W(ear|eave)s/i, "Handcrafted cotton");
const threadRule = () => `<svg class="thread-rule" viewBox="0 0 1200 30" preserveAspectRatio="none" aria-hidden="true"><path d="M0 15 C 150 -5, 300 35, 450 15 S 750 -5, 900 15 S 1100 30, 1200 12"/></svg>`;

/* ---------- bag (checkout on Shopify) ---------- */
const BAG_KEY = "nartha_bag_v1";
let bag = JSON.parse(localStorage.getItem(BAG_KEY) || "[]");
const saveBag = () => { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); renderBagCount(); };
function addToBag(handle, from) {
  const p = byHandle.get(handle); if (!p || !p.available) return;
  const it = bag.find((b) => b.handle === handle);
  it ? (it.qty = Math.min(5, it.qty + 1)) : bag.push({ handle, qty: 1 });
  saveBag(); flyToBag(from, img(p.images[0], 200)); toast(`${p.title} added to your bag`);
}
function renderBagCount() {
  const n = bag.reduce((a, b) => a + b.qty, 0);
  const el = $("#bagCount"); el.textContent = n; el.hidden = !n; pop(el);
}
// storefront=true makes Shopify fill the nartha.in cart and open the cart page instead of
// Shopify's native checkout, so customers get the same Shiprocket checkout as on nartha.in.
function checkoutUrl(items) {
  const parts = items.map((b) => [byHandle.get(b.handle), b.qty]).filter(([p]) => p).map(([p, q]) => `${p.variant}:${q}`);
  return `${CONFIG.store}/cart/${parts.join(",")}?storefront=true&ref=nartha-store`;
}
function renderBag() {
  bag = bag.filter((b) => byHandle.get(b.handle)?.available);
  const body = $("#bagBody");
  if (!bag.length) {
    body.innerHTML = `<div class="empty bag-empty">${loomSVG(84, "bagLoom")}<p>Your bag is empty. Nothing on the loom yet.</p><a class="btn line" href="#/shop" data-close-all>Browse sarees</a></div>`;
    weave($("#bagLoom"), { rows: 6, rowTime: 0.25 });
    return;
  }
  const total = bag.reduce((a, b) => a + byHandle.get(b.handle).price * b.qty, 0);
  const mrp = bag.reduce((a, b) => { const p = byHandle.get(b.handle); return a + (p.compare && p.compare > p.price ? p.compare : p.price) * b.qty; }, 0);
  body.innerHTML = `<div class="bag-items">${bag.map((b) => {
    const p = byHandle.get(b.handle);
    return `<div class="bag-item"><a href="#/p/${encodeURIComponent(p.handle)}" data-close-all><img src="${img(p.images[0], 200)}" alt=""></a>
      <div><h4>${esc(p.title)}</h4><div class="price">${inr(p.price)}</div>
        <div class="qty"><button data-q="-1" data-h="${esc(b.handle)}" aria-label="Less">−</button><span>${b.qty}</span><button data-q="1" data-h="${esc(b.handle)}" aria-label="More">+</button></div></div>
      <button class="rm" data-rm="${esc(b.handle)}">Remove</button></div>`;
  }).join("")}</div>
  <div class="bag-foot">
    ${mrp > total ? `<div class="row save"><span>You save</span><span>${inr(mrp - total)}</span></div>` : ""}
    <div class="row"><span>Subtotal</span><b>${inr(total)}</b></div>
    <small>Free shipping across India. Taxes and any charges are shown at checkout.</small>
    <a class="btn red block" href="${checkoutUrl(bag)}" data-cursor="Checkout">Checkout securely</a>
    <div class="secure">🔒 Checkout is completed securely on nartha.in</div></div>`;
}
$("#bagBody").addEventListener("click", (e) => {
  const q = e.target.closest("[data-q]"), rm = e.target.closest("[data-rm]");
  if (q) { const it = bag.find((b) => b.handle === q.dataset.h); it.qty = Math.max(1, Math.min(5, it.qty + +q.dataset.q)); }
  else if (rm) bag = bag.filter((b) => b.handle !== rm.dataset.rm);
  else return;
  saveBag(); renderBag();
});

/* ---------- overlays ---------- */
const scrim = $("#scrim");
function open(el) { closeAll(); el.classList.add("on"); el.setAttribute("aria-hidden", "false"); scrim.classList.add("on"); document.body.style.overflow = "hidden"; }
function closeAll() { document.querySelectorAll(".sheet.on,.modal.on").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-hidden", "true"); }); scrim.classList.remove("on"); document.body.style.overflow = ""; }
scrim.onclick = closeAll;
document.addEventListener("keydown", (e) => e.key === "Escape" && closeAll());
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close],[data-close-all]")) closeAll();
  if (e.target.closest("[data-open-bag]")) { renderBag(); open($("#bagSheet")); }
  if (e.target.closest("[data-open-menu]")) open($("#menuSheet"));
  if (e.target.closest("[data-open-search]")) { const s = $("#searchBar"); s.hidden = !s.hidden; if (!s.hidden) $("#searchInput").focus(); }
  const add = e.target.closest("[data-add]"); if (add) { e.preventDefault(); addToBag(add.dataset.add, add); }
  const buy = e.target.closest("[data-buy]"); if (buy) location.href = checkoutUrl([{ handle: buy.dataset.buy, qty: 1 }]);
  const tr = e.target.closest("[data-try]"); if (tr) { e.preventDefault(); openTryOn(tr.dataset.try); }
});
let tTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(tTimer); tTimer = setTimeout(() => t.classList.remove("on"), 2400); }
$("#searchInput").addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  if (location.hash.startsWith("#/shop")) renderGridOnly(); else location.hash = "#/shop";
});

/* ---------- shared pieces ---------- */
const card = (p) => `<a class="card" href="#/p/${encodeURIComponent(p.handle)}" data-cursor="View">
  <div class="ph"><img loading="lazy" src="${img(p.images[0], 600)}" alt="${esc(p.title)}">${p.images[1] ? `<img loading="lazy" src="${img(p.images[1], 600)}" alt="">` : ""}
    ${!p.available ? `<span class="tag sold">Sold out</span>` : p.compare && p.compare > p.price ? `<span class="tag">${Math.round((1 - p.price / p.compare) * 100)}% off</span>` : ""}
    ${p.available ? `<button class="quick-try" data-try="${esc(p.handle)}" data-cursor="Try on" aria-label="Try ${esc(p.title)} on">✦ Try on</button>` : ""}</div>
  <div class="meta"><div class="kind">${esc(kindOf(p) || shortCol(colTitle(p.collections[0])))}</div><h3>${esc(p.title)}</h3>
    <div class="price">${inr(p.price)}${p.compare && p.compare > p.price ? `<s>${inr(p.compare)}</s>` : ""}</div></div></a>`;

const tryOnShowcase = (compact = false) => `
  <section class="tryon-show ${compact ? "compact" : ""}">
    <div class="ts-copy" data-reveal="stagger">
      <div class="eyebrow">New · 2D virtual try-on</div>
      <h2>See the drape <em>on you,</em><br>not on a model.</h2>
      <p>Take one full-length photo. We drape the real saree on you, with its pleats, border, pallu and matching blouse, in under a minute.</p>
      <ol class="steps"><li><b>1</b><span>Pick any saree</span></li><li><b>2</b><span>Snap or upload a photo</span></li><li><b>3</b><span>See it on you, then add to bag</span></li></ol>
      <div class="ts-cta"><a class="btn turmeric" href="#/try-on" data-cursor="Try on">Try it on now</a><span class="ts-note">${CONFIG.weeklyLimit} free try-ons every week · photos stay private</span></div>
    </div>
    <div class="ts-demo" data-reveal>
      <div class="ba" id="ba" style="--pos:50%">
        <img src="assets/tryon-after-vana-chitra.jpg" alt="Try-on result: wearing Vana Chitra" class="ba-after">
        <img src="assets/tryon-before.jpg" alt="Original photo" class="ba-before">
        <div class="ba-line"><button class="ba-handle" role="slider" aria-label="Compare before and after" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">⟷</button></div>
        <span class="ba-tag l">Your photo</span><span class="ba-tag r">Vana Chitra</span>
      </div>
      <div class="ts-swatch"><img src="${img(byHandle.get("vana-chitra")?.images[1] || "", 300)}" alt=""><span>Uses the real saree's body, pallu &amp; blouse fabric</span></div>
      <small class="ts-fine">Sample person is AI-generated for this demo.</small>
    </div>
  </section>`;

const WHY = [["💰", "Affordable luxury"], ["🌿", "Safe for skin, gentle on earth"], ["🤝", "Ethically sourced, artisan-made"], ["🎨", "Heritage, reimagined"],
  ["🧵", "A wearable work of art"], ["🎉", "Festive ready"], ["🌸", "Comfort that lasts"], ["🎁", "Perfect for gifting"], ["👩‍💼", "Made for you"]];

/* ---------- views ---------- */
function home() {
  const rail = (handle, title, blurb) => {
    const ps = DATA.products.filter((p) => p.collections.includes(handle)).sort((a, b) => b.available - a.available).slice(0, 8);
    return `<section class="sec wrap rail">
      <div class="sec-head" data-reveal><div><div class="eyebrow">${esc(blurb)}</div><h2>${esc(title)}</h2></div><a href="#/c/${handle}" data-cursor="View all">View all</a></div>
      <div class="rail-track">${ps.map(card).join("")}</div></section>`;
  };
  return `
  <section class="hero-slides" id="hero" aria-label="Featured">
    ${CONFIG.heroSlides.map((s, i) => `<a class="slide ${i ? "" : "on"}" href="${s.link}" data-cursor="Explore"><img src="${img(s.img, 2000)}" alt="${esc(s.alt)}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></a>`).join("")}
    <div class="slide-bar">${CONFIG.heroSlides.map((_, i) => `<button data-slide="${i}" aria-label="Slide ${i + 1}"><i></i></button>`).join("")}</div>
  </section>

  <section class="intro wrap">
    <div class="intro-copy hero-copy">
      <div class="eyebrow">Handcrafted cotton · South India</div>
      <h1>Cotton for the days <em>that count.</em></h1>
      <p>Kalamkari, Chettinad, Malai and Sungudi sarees, woven and block-printed by hand, light enough for a full working day.</p>
      <div class="hero-cta"><a class="btn dark" href="#/shop">Shop all sarees</a><a class="btn line" href="#/try-on" data-cursor="Try on">✦ Try one on you</a></div>
    </div>
    <div class="intro-stats" data-reveal="stagger">
      <div><b>${DATA.products.length}+</b><span>handcrafted sarees</span></div>
      <div><b>100%</b><span>pure cotton</span></div>
      <div><b>3–7</b><span>days delivery, India-wide</span></div>
    </div>
  </section>
  ${threadRule()}

  <section class="sec wrap">
    <div class="sec-head" data-reveal><div><div class="eyebrow">Our collections</div><h2>Find your weave</h2></div><a href="#/shop">Shop all</a></div>
    <div class="banners">${CONFIG.collectionBanners.map((b) => `<a class="banner" href="#/c/${b.handle}" data-cursor="Explore">
      <div class="banner-img" data-unveil><img loading="lazy" src="${img(b.img, 1600)}" alt="${esc(b.alt)}"></div>
      <div class="banner-meta" data-reveal><span>${esc(b.line)}</span><b>Explore ${esc(shortCol(colTitle(b.handle)))} →</b></div></a>`).join("")}</div>
  </section>

  <div class="wrap">${tryOnShowcase()}</div>

  ${rail("fiesta", "Fiesta – The Festive Weaves", "Chettinad · Sungudi · Kanchi cotton")}
  ${rail("butterfly-collection", "Butterfly Collection", "Kalamkari · hand block-printed")}
  ${rail("the-feather", "Feather Collection", "Light · breathable · office-ready")}
  ${rail("feather-grace", "Feather Grace", "Soft jute-cotton & Malai")}

  ${threadRule()}
  <section class="sec wrap why">
    <div class="sec-head" data-reveal><div><div class="eyebrow">Why NARTHA</div><h2>Made with care, worn with ease</h2></div></div>
    <div class="why-grid" data-reveal="stagger">${WHY.map(([i, t]) => `<div><span>${i}</span><b>${t}</b></div>`).join("")}</div>
  </section>

  <section class="sec wrap founder">
    <div class="founder-img" data-unveil><img loading="lazy" src="${img(CONFIG.founderImg, 900)}" alt="Nagarathna Sridhar, founder of NARTHA"></div>
    <div class="founder-copy" data-reveal="stagger">
      <div class="eyebrow">Founder's story</div>
      <h2>"Sarees you can wear to work, to celebrations, or simply as an expression of who you are."</h2>
      <p>Nagarathna Sridhar started NARTHA after noticing how many women admire sarees but hesitate to wear them every day. Her answer: cotton sarees that blend comfort, elegance and affordability.</p>
      <a class="btn line" href="#/about">Read our story</a>
    </div>
  </section>`;
}

const state = { col: "", kind: "", sort: "featured", q: "" };
function filtered() {
  let ps = DATA.products.filter((p) => (!state.col || p.collections.includes(state.col)) && (!state.kind || kindOf(p) === state.kind));
  if (state.q) {
    const words = state.q.toLowerCase().split(/\s+/);
    ps = ps.filter((p) => { const t = (p.title + " " + p.type + " " + p.tags.join(" ") + " " + p.desc).toLowerCase(); return words.every((w) => t.includes(w)); });
  }
  const s = { "price-asc": (a, b) => a.price - b.price, "price-desc": (a, b) => b.price - a.price, new: (a, b) => (b.created || "").localeCompare(a.created || "") }[state.sort];
  if (s) ps = [...ps].sort(s);
  return ps.sort((a, b) => b.available - a.available);
}
function renderGridOnly() {
  const ps = filtered(), g = $("#grid");
  if (!g) return;
  g.innerHTML = ps.map(card).join("");
  $("#count").textContent = `${ps.length} saree${ps.length === 1 ? "" : "s"}${state.q ? ` for “${state.q}”` : ""}`;
  $("#none").hidden = !!ps.length;
  window.gsap?.from(g.children, { y: 24, opacity: 0, duration: 0.6, stagger: 0.03, ease: "power2.out", clearProps: "all" });
}
function listing(colHandle) {
  state.col = colHandle || ""; state.kind = "";
  const c = DATA.collections.find((x) => x.handle === colHandle);
  const banner = CONFIG.collectionBanners.find((b) => b.handle === colHandle);
  const kinds = [...new Set(DATA.products.filter((p) => !state.col || p.collections.includes(state.col)).map(kindOf).filter(Boolean))].sort();
  return `${banner ? `<div class="col-hero"><img src="${img(banner.img, 2000)}" alt="${esc(banner.alt)}" data-parallax="-8"></div>` : ""}
  <div class="wrap">
    <div class="list-head"><div class="eyebrow">${c ? "Collection" : "Shop"}</div><h1 class="page-title">${esc(c ? shortCol(c.title) : "All sarees")}</h1><p id="count"></p></div>
    <div class="filters">
      <button class="chip on" data-kind="">All</button>${kinds.map((k) => `<button class="chip" data-kind="${esc(k)}">${esc(k)}</button>`).join("")}
      <select id="sort" aria-label="Sort"><option value="featured">Featured</option><option value="new">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select>
    </div>
    <div class="try-strip"><span>✦ Not sure how it'll look? Tap <b>Try on</b> on any saree to see it on you.</span><a href="#/try-on">How it works</a></div>
    <div class="grid" id="grid"></div><div class="empty" id="none" hidden>Nothing matches. Try another filter.</div>
  </div>`;
}
function bindListing() {
  $("#sort").value = state.sort;
  $("#sort").onchange = (e) => { state.sort = e.target.value; renderGridOnly(); };
  document.querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("[data-kind]").forEach((x) => x.classList.toggle("on", x === b));
    state.kind = b.dataset.kind; renderGridOnly();
  }));
  renderGridOnly();
}

function product(handle) {
  const p = byHandle.get(handle);
  if (!p) return `<div class="wrap empty"><h2>Saree not found</h2><p><a class="btn line" href="#/shop">Back to shop</a></p></div>`;
  const c = p.collections[0];
  const related = DATA.products.filter((x) => x.handle !== p.handle && x.available && x.collections.includes(c)).slice(0, 4);
  const off = p.compare && p.compare > p.price ? Math.round((1 - p.price / p.compare) * 100) : 0;
  return `<div class="wrap">
  <div class="crumbs"><a href="#/">Home</a> / <a href="#/c/${c}">${esc(shortCol(colTitle(c)))}</a> / ${esc(p.title)}</div>
  <div class="pdp">
    <div class="gallery">
      <div class="thumbs">${p.images.map((u, i) => `<button class="${i ? "" : "on"}" data-img="${i}" aria-label="Image ${i + 1}"><img src="${img(u, 160)}" alt=""></button>`).join("")}</div>
      <div class="main-img" data-cursor="Zoom"><img id="mainImg" src="${img(p.images[0], 1200)}" alt="${esc(p.title)}"></div>
    </div>
    <div class="info">
      <div class="eyebrow">${esc(shortCol(colTitle(c)))} · ${esc(kindOf(p))}</div>
      <h1 class="page-title">${esc(p.title)}</h1>
      <div class="price">${inr(p.price)}${off ? `<s>${inr(p.compare)}</s><span class="off">${off}% off</span>` : ""}</div>
      <div class="tax">Inclusive of all taxes · Free shipping across India</div>
      <div class="stock ${p.available ? "" : "out"}">${p.available ? "In stock · dispatched in 1–2 business days" : "Sold out"}</div>
      ${p.available ? `
      <div class="try-card" data-cursor="Try on">
        <div class="tc-art">${loomSVG(64, "pdpLoom")}</div>
        <div><b>See it on you before you buy</b><p>Upload one full-length photo and we'll drape <i>${esc(p.title)}</i> on you, with pleats, pallu and blouse.</p>
        <button class="btn dark" data-try="${esc(p.handle)}">✦ Try it on me</button><span class="tc-note">${CONFIG.weeklyLimit} free try-ons a week</span></div></div>
      <div class="actions"><button class="btn red block" data-add="${esc(p.handle)}" data-cursor="Add">Add to bag</button><button class="btn line block" data-buy="${esc(p.handle)}" data-cursor="Buy">Buy now</button></div>`
      : `<div class="actions"><button class="btn block" disabled>Sold out</button><a class="btn line block" href="#/c/${c}">See similar sarees</a></div>`}
      <div class="perks"><div>🌿<br>Pure cotton</div><div>🧵<br>Handcrafted</div><div>🔒<br>Secure checkout</div></div>
      <details class="acc" open><summary>Description</summary><div>${esc(p.desc.slice(0, 700))}${p.desc.length > 700 ? "…" : ""}
        <div class="chips">${p.tags.filter((t) => !/nartha|saree|collection/i.test(t)).slice(0, 8).map((t) => `<span>${esc(t.replace(/-/g, " "))}</span>`).join("")}</div></div></details>
      <details class="acc"><summary>Shipping</summary><div>Orders are processed in 1–2 business days (not on Sundays or public holidays) and usually delivered in 3–7 business days across India, with tracking by email or WhatsApp. <a href="#/policy/shipping-policy">Shipping policy</a></div></details>
      <details class="acc"><summary>Returns</summary><div>Return requests within 3 days of delivery for unused, unwashed sarees with tags intact. Sale and discounted items are not returnable. <a href="#/policy/refund-policy">Refund policy</a></div></details>
      <details class="acc"><summary>Care</summary><div>Handcrafted cotton: dry clean or gentle hand wash in cold water the first few times, dry in shade, and iron on medium. Slight variations in colour and print are part of the craft.</div></details>
    </div>
  </div>
  ${related.length ? `<section class="sec"><div class="sec-head" data-reveal><h2>From the same collection</h2><a href="#/c/${c}">View all</a></div><div class="grid">${related.map(card).join("")}</div></section>` : ""}
  </div>
  ${p.available ? `<div class="mbar"><button class="btn dark" data-try="${esc(p.handle)}">✦ Try on</button><button class="btn red" data-add="${esc(p.handle)}">Add to bag · ${inr(p.price)}</button></div>` : ""}`;
}
function bindProduct(handle) {
  const p = byHandle.get(handle); if (!p) return;
  document.querySelectorAll("[data-img]").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("[data-img]").forEach((x) => x.classList.toggle("on", x === b));
    const m = $("#mainImg"); window.gsap ? window.gsap.fromTo(m, { opacity: 0.2, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.5 }) : 0;
    m.src = img(p.images[+b.dataset.img], 1200);
  }));
  const mi = $(".main-img");
  mi?.addEventListener("pointermove", (e) => { const r = mi.getBoundingClientRect(); mi.style.setProperty("--zx", ((e.clientX - r.left) / r.width) * 100 + "%"); mi.style.setProperty("--zy", ((e.clientY - r.top) / r.height) * 100 + "%"); mi.classList.add("zoom"); });
  mi?.addEventListener("pointerleave", () => mi.classList.remove("zoom"));
  weave($("#pdpLoom"), { rows: 7, rowTime: 0.3 });
}

function tryOnPage() {
  const picks = DATA.products.filter((p) => p.available && p.images.length > 1);
  const featured = ["vana-chitra", "crimson-harithaka", "suvarna-rekhini", "neela-lata"].map((h) => byHandle.get(h)).filter((p) => p?.available);
  return `<div class="wrap">
    <div class="list-head center"><div class="eyebrow">Virtual try-on</div><h1 class="page-title">Try before you <em>drape.</em></h1>
      <p>Pick a saree, add a full-length photo, and see it on you in about a minute.</p></div>
    ${tryOnShowcase(true)}
    <section class="sec">
      <div class="how" data-reveal="stagger">
        <div><span class="num">01</span><h3>Choose a saree</h3><p>Any in-stock NARTHA saree. We use its real photos, including the close-up of the body, pallu and blouse fabric.</p></div>
        <div><span class="num">02</span><h3>Add your photo</h3><p>Stand straight, head to toe in frame, in good light. Fitted clothes work best. One person only.</p></div>
        <div><span class="num">03</span><h3>See the drape</h3><p>A Nivi drape with the pallu brought forward so you see the full design. Like it? Add it to your bag.</p></div>
      </div>
    </section>
    <section class="sec">
      <div class="sec-head" data-reveal><div><div class="eyebrow">Start here</div><h2>Popular to try</h2></div><a href="#/shop">All sarees</a></div>
      <div class="grid">${featured.concat(picks.filter((p) => !featured.includes(p)).slice(0, 8 - featured.length)).map(card).join("")}</div>
    </section>
    <section class="sec faq" data-reveal="stagger">
      <h2>Questions</h2>
      <details class="acc"><summary>How many try-ons do I get?</summary><div>${CONFIG.weeklyLimit} every week per account, free. Trying the same photo with the same saree again doesn't use one, and if something goes wrong the attempt isn't counted.</div></details>
      <details class="acc"><summary>Why do I need to sign in?</summary><div>So your try-ons and photos stay private to you, and so we can keep try-on free and fair for everyone. Sign-in is just your email and a one-time code.</div></details>
      <details class="acc"><summary>What happens to my photo?</summary><div>It's resized on your phone, sent securely, used only to create your try-on, and the result is stored privately in your account. Read the <a href="#/policy/try-on-privacy">try-on &amp; photo privacy</a> note.</div></details>
      <details class="acc"><summary>How accurate is it?</summary><div>It's an AI preview built from the real saree photos, so colours, motifs, border and pallu are close, but handcrafted fabric can vary slightly in shade and print placement.</div></details>
    </section>
  </div>`;
}

function about() {
  return `<div class="about">
    <section class="about-hero wrap">
      <div class="founder-img" data-unveil><img src="${img(CONFIG.founderImg, 1000)}" alt="Nagarathna Sridhar, founder of NARTHA"></div>
      <div class="founder-copy">
        <div class="eyebrow">Founder's story</div>
        <h1 class="page-title">A journey of courage, comfort, and bringing tradition back to life.</h1>
        <p>I'm Nagarathna Sridhar, a woman who has always loved cotton sarees for the grace, comfort, and quiet confidence they bring.</p>
        <p>Over time, I noticed that many women admire sarees but hesitate to wear them every day. They often find them uncomfortable, expensive or difficult to manage in their busy lives. That realisation became the beginning of NARTHA.</p>
        <p>My vision is simple: to create cotton sarees that blend <b>comfort, elegance, and affordability</b>, making them a natural choice for modern women. Sarees you can wear to work, to celebrations, or simply as an expression of your identity, with confidence and ease.</p>
        <p>The journey hasn't been easy. After a long career break dedicated to my family, stepping into business meant learning everything from the beginning: technology, sourcing, and building a brand from scratch. There were challenges, mistakes, and moments of doubt. But what stayed constant was my belief.</p>
        <p>Today, NARTHA is built with that same passion: to help women rediscover the joy of wearing sarees, and to make tradition a part of everyday life once again.</p>
        <p class="sig">💛 NARTHA</p>
      </div>
    </section>
    ${threadRule()}
    <section class="sec wrap center-head">
      <div class="eyebrow">About NARTHA</div><h2>Where tradition meets timeless elegance.</h2>
      <p class="lede">At NARTHA, every saree begins with a purpose: to bring back the quiet power, grace, and confidence of a woman draped in tradition. Born from a deep love for cotton sarees and a journey of rediscovery, NARTHA is more than a brand. It is a movement to revive the elegance of everyday Indian wear in a world that is constantly rushing forward.</p>
      <div class="pillars" data-reveal="stagger">
        <a href="#/c/the-feather"><span>✨</span><h3>Feather Collection</h3><p>Lightweight, breathable, and easy to wear, designed for daily and office use. Because true confidence comes from comfort.</p></a>
        <a href="#/c/butterfly-collection"><span>🎨</span><h3>Butterfly Collection</h3><p>Kalamkari sarees that carry stories of skilled artisans. We bring this timeless art into modern wear, preserving heritage beautifully.</p></a>
        <a href="#/c/fiesta"><span>🎉</span><h3>Festive Weaves</h3><p>Chettinad, Narayanpet, and Sungudi sarees for your special moments. Perfect for festivals, weddings, and gifting.</p></a>
        <div><span>🌸</span><h3>Our Purpose</h3><p>To revive the true essence of cotton sarees in today's fast-paced world, making them a symbol of everyday elegance, pride, and ease.</p></div>
      </div>
    </section>
    <section class="sec wrap mv" data-reveal="stagger">
      <div><div class="eyebrow">Mission</div><p>Revive cotton sarees as everyday essentials by blending comfort, elegance, and heritage.</p></div>
      <div><div class="eyebrow">Vision</div><p>To make tradition a part of modern living, where every saree empowers and every weave tells a story.</p></div>
    </section>
    <section class="sec wrap why">
      <div class="sec-head" data-reveal><div><div class="eyebrow">Why NARTHA?</div><h2>Nine reasons she keeps coming back</h2></div></div>
      <div class="why-grid" data-reveal="stagger">${WHY.map(([i, t]) => `<div><span>${i}</span><b>${t}</b></div>`).join("")}</div>
    </section>
    <section class="sec wrap signature">
      <div class="eyebrow">Our signature product</div>
      <h2>Made with care, loved by our customers</h2>
      <p>A bestseller designed to make heads turn and invite a second glance that truly admires your elegance.</p>
      <a class="btn red" href="#/shop">Shop now</a>
    </section>
  </div>`;
}

function contact() {
  const c = CONFIG.contact;
  return `<div class="wrap contact">
    <div class="list-head"><div class="eyebrow">We'd love to hear from you</div><h1 class="page-title">Contact</h1></div>
    <div class="contact-grid">
      <form class="contact-form" action="${CONFIG.store}/contact#contact_form" method="post" accept-charset="UTF-8" data-reveal="stagger">
        <input type="hidden" name="form_type" value="contact"><input type="hidden" name="utf8" value="✓">
        <div class="field"><label for="cn">Name</label><input id="cn" name="contact[name]" autocomplete="name"></div>
        <div class="field"><label for="ce">Email *</label><input id="ce" name="contact[email]" type="email" required autocomplete="email"></div>
        <div class="field"><label for="cp">Phone</label><input id="cp" name="contact[phone]" type="tel" autocomplete="tel"></div>
        <div class="field"><label for="cm">Comment</label><textarea id="cm" name="contact[body]" rows="5"></textarea></div>
        <button class="btn red">Send message</button>
        <p class="note left">Your message is sent through our Shopify store at nartha.in.</p>
      </form>
      <aside class="contact-info" data-reveal="stagger">
        <div><h4>Phone</h4><a href="tel:+91${c.phone}">+91 ${c.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}</a></div>
        <div><h4>Email</h4><a href="mailto:${c.email}">${c.email}</a></div>
        <div><h4>Address</h4><p>${esc(c.address)}</p></div>
        <div><h4>Follow</h4><a href="https://www.instagram.com/narthaofficial/" target="_blank" rel="noopener">Instagram</a><a href="https://www.facebook.com/share/1J7cpYcEaT/" target="_blank" rel="noopener">Facebook</a><a href="https://youtube.com/@narthasarees" target="_blank" rel="noopener">YouTube</a></div>
      </aside>
    </div>
  </div>`;
}

const TRYON_PRIVACY = {
  title: "Try-on & photo privacy",
  html: `<p>This note explains how the virtual try-on on this website handles your photo. It adds to our main <a href="#/policy/privacy-policy">Privacy policy</a>.</p>
  <h3>What we collect</h3><ul><li>Your email address, to sign you in with a one-time code.</li><li>The photo you choose, resized to at most 1024 pixels on your device before it is sent.</li><li>A record of each try-on (time, saree, status) so we can apply the weekly limit.</li></ul>
  <h3>How it's used</h3><ul><li>Your photo and the saree's product photos are sent securely to our image-generation provider (OpenAI) only to create your try-on image.</li><li>The resulting image is stored privately and shown only to you through a time-limited link.</li><li>We don't use your photo for advertising, and we don't share it with anyone else.</li></ul>
  <h3>Your choices</h3><ul><li>Don't upload photos of other people without their permission, or of anyone under 18.</li><li>To delete your try-on images and account data, email <a href="mailto:info@nartha.in">info@nartha.in</a> from the address you signed in with.</li></ul>
  <p>Try-on images are AI previews. Handcrafted fabric can vary slightly in colour and print placement.</p>`,
};
function policy(handle) {
  const p = handle === "try-on-privacy" ? TRYON_PRIVACY : POLICIES[handle];
  const all = Object.entries(POLICIES).map(([h, v]) => [h, v.title]).concat([["try-on-privacy", TRYON_PRIVACY.title]]);
  if (!p) return `<div class="wrap empty"><h2>Policy not found</h2><a class="btn line" href="#/">Home</a></div>`;
  return `<div class="wrap policy">
    <aside><div class="eyebrow">Policies</div>${all.map(([h, t]) => `<a href="#/policy/${h}" class="${h === handle ? "on" : ""}">${esc(t)}</a>`).join("")}</aside>
    <article><h1 class="page-title">${esc(p.title)}</h1><div class="rte">${p.html}</div>
      ${handle !== "try-on-privacy" ? `<p class="note left">Also published at <a href="${CONFIG.store}/policies/${handle}" target="_blank" rel="noopener">nartha.in/policies/${handle}</a></p>` : ""}</article>
  </div>`;
}

/* ---------- router ---------- */
function setNav() {
  const h = location.hash || "#/";
  const links = [["#/shop", "All sarees"], ...DATA.collections.map((c) => [`#/c/${c.handle}`, shortCol(c.title)]), ["#/about", "About"], ["#/contact", "Contact"]];
  $("#nav").innerHTML = links.map(([u, t]) => `<a href="${u}" class="${h === u ? "on" : ""}">${esc(t)}</a>`).join("");
  $("#menuLinks").innerHTML = `<a href="#/" data-close-all>Home</a><a href="#/try-on" data-close-all class="m-try">✦ Virtual try-on</a>` + links.map(([u, t]) => `<a href="${u}" data-close-all>${esc(t)}</a>`).join("") + `<a href="${CONFIG.store}/account">My account</a>`;
}
function render() {
  const h = decodeURIComponent(location.hash.slice(1) || "/");
  const [, a, raw] = h.split("/"); const b = raw?.split("?")[0];
  let title = "NARTHA — Handcrafted cotton sarees";
  if (a === "p" && b) { app.innerHTML = product(b); bindProduct(b); title = `${byHandle.get(b)?.title ?? "Saree"} — NARTHA`; }
  else if (a === "c" || a === "shop") { app.innerHTML = listing(a === "c" ? b : ""); bindListing(); title = "Shop — NARTHA"; }
  else if (a === "try-on") { app.innerHTML = tryOnPage(); title = "Virtual try-on — NARTHA"; }
  else if (a === "about") { app.innerHTML = about(); title = "About NARTHA"; }
  else if (a === "contact") { app.innerHTML = contact(); title = "Contact — NARTHA"; }
  else if (a === "policy") { app.innerHTML = policy(b); title = `${(POLICIES[b]?.title || TRYON_PRIVACY.title)} — NARTHA`; }
  else { app.innerHTML = home(); heroSlideshow($("#hero")); }
  document.title = title;
  document.body.dataset.route = a || "home";
  setNav();
  window.scrollTo(0, 0);
  beforeAfter($("#ba"));
  animatePage(app);
  app.focus({ preventScroll: true });
}
let first = true;
function route() {
  if (/access_token=|error_description=/.test(location.hash)) return; // auth callback being processed
  closeAll();
  if (first) { first = false; render(); return; }
  fabricSwipe(render);
}
window.addEventListener("hashchange", route);

/* ---------- try-on ---------- */
const T = { handle: null, photo: null, photoUrl: null, email: "" };
const tBody = () => $("#tryonBody");

async function fn(payload) {
  const { data: { session } } = await (await getSb()).auth.getSession();
  const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/tryon`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, apikey: CONFIG.supabaseAnonKey },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
function header(p) {
  return `<div class="t-head"><img src="${img(p.images[0], 120)}" alt=""><div><small>Virtual try-on</small><h3>${esc(p.title)}</h3></div></div>`;
}
function quotaDots(q) {
  if (!q) return "";
  const dots = Array.from({ length: q.limit }, (_, i) => `<i class="${i < q.used ? "used" : ""}"></i>`).join("");
  const reset = q.reset_at && q.remaining === 0 ? ` · resets ${new Date(q.reset_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}` : "";
  return `<div class="quota">${dots}<span>${q.remaining} of ${q.limit} try-ons left this week${reset}</span></div>`;
}

async function openTryOn(handle) {
  T.handle = handle;
  open($("#tryon"));
  const { data: { session } } = await (await getSb()).auth.getSession();
  if (!session) return stepSignIn();
  stepPhoto();
}
function stepSignIn(err = "") {
  const p = byHandle.get(T.handle);
  tBody().innerHTML = `${header(p)}
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <p class="hint">Sign in with your email to use try-on. You get <b>${CONFIG.weeklyLimit} free try-ons every week</b>, and your photos stay private to your account.</p>
    <form id="emailForm"><div class="field"><label for="em">Email</label><input id="em" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(T.email)}"></div>
    <button class="btn dark block">Send me a code</button></form>`;
  $("#emailForm").onsubmit = async (e) => {
    e.preventDefault(); T.email = $("#em").value.trim();
    e.submitter && (e.submitter.disabled = true);
    sessionStorage.setItem("nartha_after_login", `#/p/${encodeURIComponent(T.handle)}?try`);
    const { error } = await (await getSb()).auth.signInWithOtp({ email: T.email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) return stepSignIn(error.message.includes("rate") ? "Too many emails just now. Please wait a minute and try again." : error.message);
    stepCode();
  };
}
function stepCode(err = "") {
  const p = byHandle.get(T.handle);
  tBody().innerHTML = `${header(p)}${err ? `<div class="err">${esc(err)}</div>` : ""}
    <p class="hint">We sent a sign-in email to <b>${esc(T.email)}</b>. Enter the code from it, or just tap the link in the email.</p>
    <form id="codeForm"><div class="field"><label for="code">Code</label><input id="code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></div>
    <button class="btn dark block">Verify</button></form>
    <p class="note"><a href="#" id="back" style="text-decoration:underline">Use a different email</a></p>`;
  $("#back").onclick = (e) => { e.preventDefault(); stepSignIn(); };
  $("#codeForm").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await (await getSb()).auth.verifyOtp({ email: T.email, token: $("#code").value.trim(), type: "email" });
    if (error) return stepCode("That code didn't work. Check the latest email and try again.");
    sessionStorage.removeItem("nartha_after_login");
    stepPhoto();
  };
}
async function stepPhoto(err = "") {
  const p = byHandle.get(T.handle);
  tBody().innerHTML = `${header(p)}<div class="loader" style="padding:20px">${loomSVG(72, "qLoom")}</div>`;
  weave($("#qLoom"), { rows: 6, rowTime: 0.2 });
  const { data: q } = await fn({ action: "status" });
  T.quota = q;
  if (q?.error === "sign_in_required") return stepSignIn();
  if (q && q.enabled === false) {
    tBody().innerHTML = `${header(p)}<div class="err">Try-on is being set up and will open shortly. You can still add this saree to your bag.</div><button class="btn red block" data-add="${esc(p.handle)}" data-close>Add to bag</button>`;
    return;
  }
  if (q && q.remaining <= 0) return stepLimit(q);
  tBody().innerHTML = `${header(p)}${quotaDots(q)}${err ? `<div class="err">${esc(err)}</div>` : ""}
    ${T.photoUrl ? `
      <div class="preview"><figure><img src="${T.photoUrl}" alt="Your photo"><figcaption>You</figcaption></figure><figure><img src="${img(p.images[0], 500)}" alt=""><figcaption>${esc(p.title)}</figcaption></figure></div>
      <button class="btn red block" id="go">Drape it on me · uses 1 try-on</button>
      <button class="btn line block" style="margin-top:8px" id="change">Use a different photo</button>`
    : `<div class="guide"><div><b>🧍‍♀️</b>Full length, head to toe</div><div><b>☀️</b>Good light, face visible</div><div><b>🙆‍♀️</b>Stand straight, arms down</div></div>
      <div class="drop"><b>Add your photo</b><span class="hint">Fitted clothes work best. One person only.</span>
        <div class="row"><label class="btn dark"><input type="file" accept="image/*" capture="environment" hidden id="cam">Take photo</label>
        <label class="btn line"><input type="file" accept="image/*" hidden id="file">Upload</label></div></div>`}
    <p class="note">Results are AI previews; actual colours and drape can vary slightly. Your photo is used only to make your try-on.</p>`;
  const pick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { T.photo = await shrink(f); T.photoUrl = "data:image/jpeg;base64," + T.photo; stepPhoto(); }
    catch { stepPhoto("We couldn't read that photo. Please try a JPG or PNG."); }
  };
  $("#cam") && ($("#cam").onchange = pick);
  $("#file") && ($("#file").onchange = pick);
  $("#change") && ($("#change").onclick = () => { T.photo = T.photoUrl = null; stepPhoto(); });
  $("#go") && ($("#go").onclick = generate);
}
function stepLimit(q) {
  const p = byHandle.get(T.handle);
  const when = q.reset_at ? new Date(q.reset_at).toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "next week";
  tBody().innerHTML = `${header(p)}${quotaDots(q)}
    <p class="hint">You've used this week's ${q.limit} try-ons. Your next one unlocks on <b>${esc(when)}</b>.</p>
    <p class="hint">Earlier try-ons of the same photo and saree are always free to view again.</p>
    <button class="btn red block" data-add="${esc(p.handle)}" data-close>Add to bag</button>`;
}
const MSG = {
  weekly_limit: null, daily_cap: "Try-on is very busy today. Please come back tomorrow.", paused: "Try-on is paused for a short while.",
  not_configured: "Try-on is being set up and will open shortly.", out_of_stock: "This saree just sold out.",
  photo_too_large: "That photo is too large. Please try another.", generation_failed: "Something went wrong while draping. This attempt didn't count. Please try again.",
};
async function generate() {
  const p = byHandle.get(T.handle);
  const lines = ["Reading the weave…", "Setting the pleats…", "Placing the pallu…", "Matching the blouse…", "Almost there…"];
  tBody().innerHTML = `${header(p)}<div class="loader">${loomSVG(130, "tryLoom")}<b id="ld">${lines[0]}</b><span class="hint">This takes about 30–60 seconds. Keep this open.</span></div>`;
  const loomTl = weave($("#tryLoom"), { rows: 9, rowTime: 0.45 });
  let i = 0; const iv = setInterval(() => { const el = $("#ld"); if (el) el.textContent = lines[Math.min(++i, lines.length - 1)]; }, 7000);
  const { status, data } = await fn({ photo: T.photo, handle: p.handle });
  clearInterval(iv); loomTl.kill?.();
  if (status === 401) return stepSignIn("Please sign in again.");
  if (data.error === "weekly_limit") return stepLimit({ limit: data.limit, used: data.limit, remaining: 0, reset_at: data.reset_at });
  if (!data.image) return stepPhoto(MSG[data.error] || "Something went wrong. Please try again.");
  if (typeof data.remaining === "number") T.quota = { ...T.quota, remaining: data.remaining, used: T.quota.limit - data.remaining };
  tBody().innerHTML = `${header(p)}<div class="result"><img class="reveal-img" src="${data.image}" alt="You wearing ${esc(p.title)}">
    ${data.cached ? `<p class="note">You've tried this one before, so this didn't use a try-on.</p>` : quotaDots(T.quota)}
    <div class="row"><button class="btn red" data-add="${esc(p.handle)}">Add to bag</button><a class="btn line" href="${data.image}" download="nartha-${esc(p.handle)}.png" target="_blank" rel="noopener">Save image</a></div>
    <p class="note">AI preview. Handcrafted fabric may vary slightly in colour and print placement.</p></div>`;
  window.gsap?.fromTo(".reveal-img", { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", duration: 1.2, ease: "power4.inOut" });
}
async function shrink(file, max = 1024) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}


/* ---------- boot ---------- */
(async () => {
  await loadCatalog();
  renderBagCount();
  $("#yr").textContent = new Date().getFullYear();
  if (/access_token=/.test(location.hash)) {
    // returning from the email sign-in link
    const back = sessionStorage.getItem("nartha_after_login") || "#/";
    await (await getSb()).auth.getSession();
    location.hash = back.split("?")[0];
  } else route();
  finishLoader();
  initCursor();
})();
