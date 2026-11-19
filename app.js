import { CONFIG } from "./config.js";

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
      if (h) setTimeout(() => openTryOn(decodeURIComponent(h[1])), 300);
    }
  });
  return _sb;
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const img = (u, w = 800) => (u ? u + (u.includes("?") ? "&" : "?") + "width=" + w : "");
const app = $("#app");

let DATA = { collections: [], products: [] };
const byHandle = new Map();

/* ---------- catalog ---------- */
async function loadCatalog() {
  const r = await fetch("data/catalog.json", { cache: "no-cache" });
  DATA = await r.json();
  DATA.collections.forEach((c) => (c.title = c.title.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim()));
  DATA.products.forEach((p) => byHandle.set(p.handle, p));
}
const colTitle = (h) => DATA.collections.find((c) => c.handle === h)?.title ?? "";
const shortCol = (t) => t.replace(/\s*-\s*The Festive Weaves/i, "").replace(/ Collection$/i, "");
const kindOf = (p) => (p.type || "").replace(/Chetttinadu/i, "Chettinad").replace(/Special W(ear|eave)s/i, "Handcrafted cotton");

/* ---------- bag (checkout on Shopify) ---------- */
const BAG_KEY = "nartha_bag_v1";
let bag = JSON.parse(localStorage.getItem(BAG_KEY) || "[]");
const saveBag = () => { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); renderBagCount(); };
function addToBag(handle, qty = 1) {
  const it = bag.find((b) => b.handle === handle);
  it ? (it.qty += qty) : bag.push({ handle, qty });
  saveBag(); toast("Added to your bag");
}
function renderBagCount() {
  const n = bag.reduce((a, b) => a + b.qty, 0);
  const el = $("#bagCount"); el.textContent = n; el.hidden = !n;
}
function checkoutUrl(items) {
  const parts = items.map((b) => `${byHandle.get(b.handle)?.variant}:${b.qty}`).filter((x) => !x.startsWith("undefined"));
  return `${CONFIG.store}/cart/${parts.join(",")}?ref=nartha-store`;
}
function renderBag() {
  bag = bag.filter((b) => byHandle.has(b.handle));
  const body = $("#bagBody");
  if (!bag.length) {
    body.innerHTML = `<div class="empty"><p>Your bag is empty.</p><a class="btn line" href="#/shop" data-close-all>Browse sarees</a></div>`;
    return;
  }
  const total = bag.reduce((a, b) => a + byHandle.get(b.handle).price * b.qty, 0);
  body.innerHTML = `<div class="bag-items">${bag.map((b) => {
    const p = byHandle.get(b.handle);
    return `<div class="bag-item"><img src="${img(p.images[0], 200)}" alt="">
      <div><h4>${esc(p.title)}</h4><div class="price">${inr(p.price)}</div>
        <div class="qty"><button data-q="-1" data-h="${esc(b.handle)}" aria-label="Less">−</button><span>${b.qty}</span><button data-q="1" data-h="${esc(b.handle)}" aria-label="More">+</button></div></div>
      <button class="rm" data-rm="${esc(b.handle)}">Remove</button></div>`;
  }).join("")}</div>
  <div class="bag-foot"><div class="row"><span>Subtotal</span><b>${inr(total)}</b></div>
    <small>Shipping and taxes calculated at checkout.</small>
    <a class="btn red block" href="${checkoutUrl(bag)}">Checkout securely</a></div>`;
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
  const add = e.target.closest("[data-add]"); if (add) addToBag(add.dataset.add);
  const buy = e.target.closest("[data-buy]"); if (buy) location.href = checkoutUrl([{ handle: buy.dataset.buy, qty: 1 }]);
  const tr = e.target.closest("[data-try]"); if (tr) openTryOn(tr.dataset.try);
});
let tTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(tTimer); tTimer = setTimeout(() => t.classList.remove("on"), 2200); }
$("#searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  if (location.hash.startsWith("#/shop")) { state.q = q; renderGridOnly(); } else { state.q = q; location.hash = "#/shop"; }
});

/* ---------- views ---------- */
const card = (p) => `<a class="card" href="#/p/${encodeURIComponent(p.handle)}">
  <div class="ph"><img loading="lazy" src="${img(p.images[0], 600)}" alt="${esc(p.title)}">${p.images[1] ? `<img loading="lazy" src="${img(p.images[1], 600)}" alt="">` : ""}
    ${!p.available ? `<span class="tag sold">Sold out</span>` : p.compare && p.compare > p.price ? `<span class="tag">Sale</span>` : ""}</div>
  <div class="meta"><div class="kind">${esc(kindOf(p) || shortCol(colTitle(p.collections[0])))}</div><h3>${esc(p.title)}</h3>
    <div class="price">${inr(p.price)}${p.compare && p.compare > p.price ? `<s>${inr(p.compare)}</s>` : ""}</div></div></a>`;

function home() {
  const newest = [...DATA.products].filter((p) => p.available).sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  const heroImgs = (CONFIG.heroHandles || []).map((h) => byHandle.get(h)).filter(Boolean).concat(newest).slice(0, 3).map((p) => p.images[0]);
  const teaser = byHandle.get("vana-chitra") || newest[3];
  return `<div class="wrap">
  <section class="hero">
    <div>
      <div class="eyebrow">Handcrafted cotton · South India</div>
      <h1>Cotton for the days <em>that count.</em></h1>
      <p>Kalamkari, Chettinad, Malai and Sungudi sarees: woven and block-printed by hand, light enough for a full working day.</p>
      <div class="hero-cta"><a class="btn dark" href="#/shop">Shop all sarees</a><a class="btn line" href="#/c/fiesta">Festive weaves</a></div>
    </div>
    <div class="hero-art">${heroImgs.map((u) => `<img src="${img(u, 900)}" alt="">`).join("")}<div class="stamp">Try it on<br>before you buy</div></div>
  </section>
  </div>
  <div class="wrap"><div class="promise">
    <div><b>Pure cotton</b><p>Breathable, soft, made to be worn every day, not saved for occasions.</p></div>
    <div><b>Made by hand</b><p>Block-printed and handloom pieces; small variations are the craft.</p></div>
    <div><b>See it on you</b><p>Upload a photo and see the drape before you order.</p></div>
  </div></div>
  <section class="sec wrap">
    <div class="sec-head"><h2>Collections</h2><a href="#/shop">View all</a></div>
    <div class="cols">${DATA.collections.map((c) => {
      const cover = DATA.products.find((p) => p.collections.includes(c.handle) && p.available)?.images[0] || c.image;
      return `<a class="col" href="#/c/${c.handle}"><img loading="lazy" src="${img(cover, 700)}" alt=""><div><span>${c.count} sarees</span><h3>${esc(shortCol(c.title))}</h3></div></a>`;
    }).join("")}</div>
  </section>
  <section class="sec wrap">
    <div class="teaser">
      <div class="t-copy">
        <div class="eyebrow">Virtual try-on</div>
        <h2>See the drape <em>on you,</em> not a model.</h2>
        <p>Take a full-length photo and we'll drape any NARTHA saree on you, with pleats, pallu and blouse, in under a minute.</p>
        <ul><li>Uses the real saree's border, pallu and blouse</li><li>Your photo stays private to your account</li><li>${CONFIG.weeklyLimit} free try-ons every week</li></ul>
        <a class="btn" style="background:var(--turmeric);color:var(--ink)" href="#/p/${encodeURIComponent(teaser.handle)}">Try ${esc(teaser.title)}</a>
      </div>
      <div class="t-img" style="background-image:url('${img(teaser.images[0], 900)}')"></div>
    </div>
  </section>
  <section class="sec wrap">
    <div class="sec-head"><h2>New on the loom</h2><a href="#/shop">Shop all</a></div>
    <div class="grid">${newest.slice(0, 8).map(card).join("")}</div>
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
  g.innerHTML = ps.length ? ps.map(card).join("") : "";
  $("#count").textContent = `${ps.length} saree${ps.length === 1 ? "" : "s"}${state.q ? ` for “${state.q}”` : ""}`;
  $("#none").hidden = !!ps.length;
}
function listing(colHandle) {
  state.col = colHandle || ""; state.kind = "";
  const c = DATA.collections.find((x) => x.handle === colHandle);
  const kinds = [...new Set(DATA.products.filter((p) => !state.col || p.collections.includes(state.col)).map(kindOf).filter(Boolean))].sort();
  return `<div class="wrap">
    <div class="list-head"><div class="eyebrow">${c ? "Collection" : "Shop"}</div><h1>${esc(c ? shortCol(c.title) : "All sarees")}</h1><p id="count"></p></div>
    <div class="filters">
      <button class="chip on" data-kind="">All</button>${kinds.map((k) => `<button class="chip" data-kind="${esc(k)}">${esc(k)}</button>`).join("")}
      <select id="sort" aria-label="Sort"><option value="featured">Featured</option><option value="new">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select>
    </div>
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
  return `<div class="wrap">
  <div class="crumbs"><a href="#/">Home</a> / <a href="#/c/${c}">${esc(shortCol(colTitle(c)))}</a> / ${esc(p.title)}</div>
  <div class="pdp">
    <div class="gallery">
      <div class="thumbs">${p.images.map((u, i) => `<button class="${i ? "" : "on"}" data-img="${i}"><img src="${img(u, 160)}" alt=""></button>`).join("")}</div>
      <div class="main-img"><img id="mainImg" src="${img(p.images[0], 1100)}" alt="${esc(p.title)}"></div>
    </div>
    <div class="info">
      <div class="eyebrow">${esc(shortCol(colTitle(c)))} · ${esc(kindOf(p))}</div>
      <h1>${esc(p.title)}</h1>
      <div class="price">${inr(p.price)}${p.compare && p.compare > p.price ? `<s>${inr(p.compare)}</s>` : ""}</div>
      <div class="tax">Inclusive of all taxes</div>
      <div class="stock ${p.available ? "" : "out"}">${p.available ? "In stock, ready to ship" : "Sold out"}</div>
      ${p.available ? `
      <div class="try-card"><div class="ico"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg></div>
        <div><b>See it on you</b><p>Upload a full-length photo and we'll drape this saree on you.</p>
        <button class="btn dark" data-try="${esc(p.handle)}">Try it on</button></div></div>
      <div class="actions"><button class="btn red block" data-add="${esc(p.handle)}">Add to bag</button><button class="btn line block" data-buy="${esc(p.handle)}">Buy now</button></div>`
      : `<div class="actions"><button class="btn block" disabled>Sold out</button></div>`}
      <div class="perks"><div>Pure cotton</div><div>Handcrafted</div><div>Secure checkout</div></div>
      <div class="desc">${esc(p.desc.slice(0, 520))}${p.desc.length > 520 ? "…" : ""}
        <div class="chips">${p.tags.filter((t) => !/nartha|saree|collection/i.test(t)).slice(0, 8).map((t) => `<span>${esc(t.replace(/-/g, " "))}</span>`).join("")}</div></div>
    </div>
  </div>
  ${related.length ? `<section class="sec"><div class="sec-head"><h2>From the same collection</h2></div><div class="grid">${related.map(card).join("")}</div></section>` : ""}
  </div>`;
}
function bindProduct(handle) {
  const p = byHandle.get(handle); if (!p) return;
  document.querySelectorAll("[data-img]").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("[data-img]").forEach((x) => x.classList.toggle("on", x === b));
    $("#mainImg").src = img(p.images[+b.dataset.img], 1100);
  }));
}

/* ---------- router ---------- */
function setNav() {
  const h = location.hash;
  const links = [["#/shop", "All sarees"], ...DATA.collections.map((c) => [`#/c/${c.handle}`, shortCol(c.title)])];
  $("#nav").innerHTML = links.map(([u, t]) => `<a href="${u}" class="${h === u ? "on" : ""}">${esc(t)}</a>`).join("");
  $("#menuLinks").innerHTML = `<a href="#/" data-close-all>Home</a>` + links.map(([u, t]) => `<a href="${u}" data-close-all>${esc(t)}</a>`).join("");
}
function route() {
  if (/access_token=|error_description=/.test(location.hash)) return; // auth callback being processed
  const h = decodeURIComponent(location.hash.slice(1) || "/");
  const [, a, raw] = h.split("/"); const b = raw?.split("?")[0];
  closeAll();
  if (a === "p" && b) { app.innerHTML = product(b); bindProduct(b); document.title = `${byHandle.get(b)?.title ?? "Saree"} — NARTHA`; }
  else if (a === "c" || a === "shop") { app.innerHTML = listing(a === "c" ? b : ""); bindListing(); document.title = "Shop — NARTHA"; }
  else { app.innerHTML = home(); document.title = "NARTHA — Handcrafted cotton sarees"; }
  setNav();
  if (!history.state?.keepScroll) window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
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
  tBody().innerHTML = `${header(p)}<div class="loader" style="padding:20px"><div class="loom"></div></div>`;
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
  tBody().innerHTML = `${header(p)}<div class="loader"><div class="loom"></div><b id="ld">${lines[0]}</b><span class="hint">This takes about 30–60 seconds.</span></div>`;
  let i = 0; const iv = setInterval(() => { const el = $("#ld"); if (el) el.textContent = lines[Math.min(++i, lines.length - 1)]; }, 7000);
  const { status, data } = await fn({ photo: T.photo, handle: p.handle });
  clearInterval(iv);
  if (status === 401) return stepSignIn("Please sign in again.");
  if (data.error === "weekly_limit") return stepLimit({ limit: data.limit, used: data.limit, remaining: 0, reset_at: data.reset_at });
  if (!data.image) return stepPhoto(MSG[data.error] || "Something went wrong. Please try again.");
  if (typeof data.remaining === "number") T.quota = { ...T.quota, remaining: data.remaining, used: T.quota.limit - data.remaining };
  tBody().innerHTML = `${header(p)}<div class="result"><img src="${data.image}" alt="You wearing ${esc(p.title)}">
    ${data.cached ? `<p class="note">You've tried this one before, so this didn't use a try-on.</p>` : quotaDots(T.quota)}
    <div class="row"><button class="btn red" data-add="${esc(p.handle)}">Add to bag</button><a class="btn line" href="${data.image}" download="nartha-${esc(p.handle)}.png" target="_blank" rel="noopener">Save image</a></div>
    <p class="note">AI preview. Handcrafted fabric may vary slightly in colour and print placement.</p></div>`;
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
  app.innerHTML = `<div class="loader" style="padding:120px 0"><div class="loom"></div></div>`;
  await loadCatalog();
  renderBagCount();
  if (/access_token=/.test(location.hash)) {
    // returning from the email sign-in link
    const back = sessionStorage.getItem("nartha_after_login") || "#/";
    await (await getSb()).auth.getSession();
    location.hash = back.split("?")[0];
  } else route();
})();
