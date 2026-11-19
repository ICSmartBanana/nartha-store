"""Pull the public NARTHA catalogue from Shopify into data/catalog.json.
Run: python3 scripts/sync.py   (also runs nightly via GitHub Actions)"""
import json, re, html, urllib.request
STORE = "https://www.nartha.in"
def get(path):
    req = urllib.request.Request(STORE + path, headers={"User-Agent": "nartha-store-sync"})
    return json.load(urllib.request.urlopen(req, timeout=30))
def products(path):
    out, page = [], 1
    while True:
        batch = get(f"{path}?limit=250&page={page}")["products"]
        out += batch
        if len(batch) < 250: return out
        page += 1
def clean_title(t):
    t = re.sub(r"[\U0001F300-\U0001FAFF☀-➿]", "", t)
    t = re.split(r"\s+[-–|]\s+|\s+NARTHA|\s+Nartha|\|", t)[0]
    return t.strip(" -–|")
def nice_title(p):
    t = clean_title(p["title"]) or p["title"]
    m = re.search(r"<h[1-3][^>]*>(.*?)</h[1-3]>", p.get("body_html") or "", re.S)
    if m:
        h = text(m.group(1))
        if " – " in h and h.split(" – ")[0].strip().lower() == t.lower():
            h = re.sub(r"\s*[–-]\s*nartha.*$", "", h, flags=re.I)
            return h.strip()
    return t
def tidy(t):
    t = re.sub(r"[\ufe0f\u200d\u201c\u201d\"\U0001F300-\U0001FAFF\u2600-\u27BF]", "", t).strip()
    t = re.sub(r"^NARTHA\s+(feather grace|feather|butterfly|fiesta)\s*[–—-]\s*", "", t, flags=re.I)
    parts = re.split(r"\s+[–—]\s+", t)
    if len(parts) == 2 and re.search(r"saree", parts[1], re.I): t = parts[0]
    t = re.sub(r"[\u2010-\u2015\-\s\u00a8\u02dc~]+$", "", t).strip()
    t = re.sub(r"\s*[–-]\s*(feather grace|feather|butterfly|fiesta)( collection)?$", "", t, flags=re.I)
    if t.isupper(): t = t.title()
    return t
def text(body):
    t = html.unescape(re.sub(r"<[^>]+>", " ", body or ""))
    t = re.sub(r"[\U0001F300-\U0001FAFF☀-➿]", "", t)
    return re.sub(r"\s+", " ", t).strip()
cols = [c for c in get("/collections.json?limit=250")["collections"]]
col_of = {}
for c in cols:
    for p in products(f"/collections/{c['handle']}/products.json"):
        col_of.setdefault(p["handle"], []).append(c["handle"])
items = []
for p in products("/products.json"):
    v = p["variants"][0]
    items.append({
        "id": p["id"], "handle": p["handle"], "title": tidy(nice_title(p)),
        "type": p.get("product_type") or "", "tags": p.get("tags") or [],
        "price": float(v["price"]), "compare": float(v["compare_at_price"]) if v.get("compare_at_price") else None,
        "variant": v["id"], "available": any(x.get("available") for x in p["variants"]),
        "images": [i["src"] for i in p.get("images", [])][:6],
        "desc": re.sub(r"^.{0,80}?\b(nartha|NARTHA|Nartha)\b\s*[-–]?\s*\w+\s+collections?\s*", "", text(p.get("body_html")))[:900],
        "collections": col_of.get(p["handle"], []),
        "created": p.get("created_at"),
    })
data = {"store": STORE, "collections": [{"handle": c["handle"], "title": c["title"],
        "image": (c.get("image") or {}).get("src"), "count": sum(1 for i in items if c["handle"] in i["collections"])} for c in cols],
        "products": items}
json.dump(data, open("data/catalog.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(items), "products;", [(c["title"], c["count"]) for c in data["collections"]], sum(i["available"] for i in items), "in stock")
