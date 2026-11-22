#!/usr/bin/env python3
"""Publish customer-shared try-ons to NARTHA's social channels.

Run by .github/workflows/publish-shares.yml. Each run:
  1. Takes down posts for shares that were withdrawn by the customer or rejected by an admin.
  2. For approved shares (or pending ones when share_config.auto_publish is on), up to max_posts_per_run:
     builds a branded 1080x1350 post image (+ a 1080x1920 Short for YouTube), uploads it to the public
     share-media bucket, then posts to every channel in share_config.channels that has credentials.
With no channels configured, approved shares just get their post image and caption, ready to post by hand.

Settings live in the share_config table. Credentials are GitHub secrets:
  SUPABASE_SERVICE_ROLE_KEY            required (service_role or sb_secret_ key)
  META_PAGE_ID, META_PAGE_TOKEN        Facebook Page (and the token is used for Instagram too)
  IG_USER_ID                           Instagram professional account linked to that Page
  YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN   YouTube channel (OAuth, youtube.upload scope)
  META_GRAPH_VERSION                   optional, default v23.0

Local preview without any credentials:
  python scripts/publish_shares.py --preview RESULT.png HANDLE OUTDIR
"""
import json, os, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://lkeinzvwnnmunibzeqdp.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GRAPH = f"https://graph.facebook.com/{os.environ.get('META_GRAPH_VERSION', 'v23.0')}"
UA = {"User-Agent": "nartha-share-publisher"}
MAX_ATTEMPTS = 5

PAPER, PAPER2, INK, INK2, MADDER = (246, 240, 230), (239, 230, 215), (42, 31, 26), (94, 80, 72), (162, 59, 42)
FONT_URLS = {
    "serif": "https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf",
    "sans": "https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf",
}


# ---------------------------------------------------------------- http helpers
def http(method, url, data=None, headers=None, raw=False, timeout=120):
    h = {**UA, **(headers or {})}
    body = data
    if isinstance(data, (dict, list)) and not raw:
        body = json.dumps(data).encode()
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            content = r.read()
            return r.status, content, r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def sb_headers(extra=None):
    h = {"apikey": KEY}
    if not KEY.startswith("sb_"):  # legacy JWT keys also go in Authorization
        h["Authorization"] = f"Bearer {KEY}"
    return {**h, **(extra or {})}


def rest(method, path, data=None, prefer=None):
    h = sb_headers({"Prefer": prefer} if prefer else None)
    status, content, _ = http(method, f"{SUPABASE_URL}/rest/v1/{path}", data, h)
    if status >= 300:
        raise RuntimeError(f"supabase {method} {path.split('?')[0]}: {status} {content[:300]!r}")
    return json.loads(content) if content else None


def update_share(sid, fields):
    rest("PATCH", f"shares?id=eq.{sid}", fields, prefer="return=minimal")


def storage_get(bucket, path):
    status, content, _ = http("GET", f"{SUPABASE_URL}/storage/v1/object/{bucket}/{urllib.parse.quote(path)}", headers=sb_headers())
    if status >= 300:
        raise RuntimeError(f"download {bucket}/{path}: {status}")
    return content


def storage_put(bucket, path, data, ctype):
    h = sb_headers({"Content-Type": ctype, "x-upsert": "true", "Cache-Control": "no-cache"})
    status, content, _ = http("POST", f"{SUPABASE_URL}/storage/v1/object/{bucket}/{urllib.parse.quote(path)}", data, h, raw=True)
    if status >= 300:
        raise RuntimeError(f"upload {bucket}/{path}: {status} {content[:200]!r}")
    return f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{urllib.parse.quote(path)}"


def storage_delete(bucket, paths):
    if paths:
        http("DELETE", f"{SUPABASE_URL}/storage/v1/object/{bucket}", {"prefixes": paths}, sb_headers())


# ---------------------------------------------------------------- catalogue + text
def catalog():
    data = json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))
    return {p["handle"]: p for p in data["products"]}


def price_text(p):
    try:
        return f"{float(p.get('price') or 0):,.0f}"
    except ValueError:
        return str(p.get("price") or "")


def caption_for(cfg, p, handle):
    url = cfg["site_url"].rstrip("/") + "/#/p/" + urllib.parse.quote(handle)
    fields = {"title": p.get("title", "NARTHA saree"), "price": price_text(p), "url": url, "type": p.get("type", "")}
    out = cfg["caption_template"]
    for k, v in fields.items():
        out = out.replace("{" + k + "}", str(v))
    return out


# ---------------------------------------------------------------- image composition
_fonts = {}


def font(kind, size, weight=None):
    path = Path(tempfile.gettempdir()) / f"nartha-{kind}.ttf"
    if not path.exists():
        status, content, _ = http("GET", FONT_URLS[kind])
        if status != 200:
            raise RuntimeError(f"font download failed: {kind}")
        path.write_bytes(content)
    f = ImageFont.truetype(str(path), size)
    if weight:
        try:
            axes = f.get_variation_axes()
            f.set_variation_by_axes([weight if a.get("name", b"") in (b"Weight", "Weight") else a["default"] for a in axes])
        except Exception:
            pass
    return f


def fetch_image(url, width=1600):
    sep = "&" if "?" in url else "?"
    status, content, _ = http("GET", f"{url}{sep}width={width}", headers={"Accept": "image/jpeg,image/png"})
    if status != 200:
        raise RuntimeError(f"product image {status}")
    return Image.open(BytesIO(content)).convert("RGB")


def fit_text(draw, text, kind, size, max_w, weight=None, min_size=20):
    while size > min_size:
        f = font(kind, size, weight)
        if draw.textlength(text, font=f) <= max_w:
            return f, text
        size -= 2
    f = font(kind, min_size, weight)
    while draw.textlength(text + "…", font=f) > max_w and len(text) > 4:
        text = text[:-1]
    return f, text.rstrip() + "…"


def blurred_fill(img, size):
    bg = ImageOps.fit(img, size, Image.LANCZOS)
    bg = bg.filter(ImageFilter.GaussianBlur(40))
    return Image.blend(bg, Image.new("RGB", size, PAPER), 0.45)


def contain(img, box):
    s = min(box[0] / img.width, box[1] / img.height)
    return img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)


def thumb_card(prod, w, h):
    card = Image.new("RGB", (w + 12, h + 12), (255, 255, 255))
    card.paste(ImageOps.fit(prod, (w, h), Image.LANCZOS, centering=(0.5, 0.3)), (6, 6))
    return card


def compose_post(result, prod, p):
    """1080x1350 feed post: try-on on a soft blurred backdrop, brand band, saree thumbnail."""
    W, H, BAND = 1080, 1350, 190
    canvas = Image.new("RGB", (W, H), PAPER)
    top = (W, H - BAND)
    canvas.paste(blurred_fill(result, top), (0, 0))
    fg = contain(result, (W - 80, top[1] - 40))
    canvas.paste(fg, ((W - fg.width) // 2, (top[1] - fg.height) // 2 + 10))
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, H - BAND, W, H], fill=PAPER)
    d.line([0, H - BAND, W, H - BAND], fill=PAPER2, width=2)
    tw, th = 150, 196
    canvas.paste(thumb_card(prod, tw, th), (W - tw - 48, H - th - 40))
    text_w = W - tw - 48 - 48 - 40
    d.text((48, H - BAND + 26), "NARTHA", font=font("serif", 46, 600), fill=INK)
    f, t = fit_text(d, p.get("title", ""), "sans", 30, text_w, 600)
    d.text((48, H - BAND + 88), t, font=f, fill=INK2)
    d.text((48, H - BAND + 134), f"Virtual try-on  ·  ₹{price_text(p)}  ·  Try yours free online", font=font("sans", 22, 500), fill=MADDER)
    return canvas


def compose_short_frames(result, prod, p):
    """Two 1080x1920 frames for a YouTube Short: the saree, then the try-on."""
    W, H = 1080, 1920
    a = ImageOps.fit(prod, (W, H), Image.LANCZOS, centering=(0.5, 0.35))
    shade = Image.new("RGB", (W, 520), INK)
    mask = Image.linear_gradient("L").resize((W, 520))
    a.paste(shade, (0, H - 520), mask.point(lambda v: int(v * 0.8)))
    d = ImageDraw.Draw(a)
    f, t = fit_text(d, p.get("title", ""), "serif", 64, W - 120, 500)
    d.text((60, H - 330), "The saree", font=font("sans", 30, 600), fill=(217, 164, 65))
    d.text((60, H - 280), t, font=f, fill=PAPER)
    d.text((60, H - 180), f"₹{price_text(p)}  ·  handcrafted cotton", font=font("sans", 32, 500), fill=PAPER)

    b = blurred_fill(result, (W, H))
    fg = contain(result, (W - 60, H - 420))
    b.paste(fg, ((W - fg.width) // 2, 120))
    d = ImageDraw.Draw(b)
    d.rectangle([0, H - 280, W, H], fill=PAPER)
    d.text((60, H - 250), "NARTHA", font=font("serif", 60, 600), fill=INK)
    f, t = fit_text(d, "Tried on virtually: " + p.get("title", ""), "sans", 34, W - 120, 600)
    d.text((60, H - 170), t, font=f, fill=INK2)
    d.text((60, H - 112), "Try it on yourself, free", font=font("sans", 30, 500), fill=MADDER)
    return a, b


def make_short(frames, out):
    with tempfile.TemporaryDirectory() as tmp:
        fa, fb = Path(tmp, "a.jpg"), Path(tmp, "b.jpg")
        frames[0].save(fa, quality=92)
        frames[1].save(fb, quality=92)
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-loop", "1", "-t", "3", "-i", str(fa), "-loop", "1", "-t", "6", "-i", str(fb),
            "-filter_complex", "[0][1]xfade=transition=fade:duration=1:offset=2,format=yuv420p",
            "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", str(out),
        ], check=True)


def jpeg_bytes(img):
    buf = BytesIO()
    img.save(buf, "JPEG", quality=90, optimize=True, progressive=True)
    return buf.getvalue()


# ---------------------------------------------------------------- channels
def meta_ok():
    return bool(os.environ.get("META_PAGE_ID") and os.environ.get("META_PAGE_TOKEN"))


def graph(method, path, params):
    params = {**params, "access_token": os.environ["META_PAGE_TOKEN"]}
    data = urllib.parse.urlencode(params).encode()
    if method == "DELETE":
        status, content, _ = http("DELETE", f"{GRAPH}/{path}?{data.decode()}")
    else:
        status, content, _ = http(method, f"{GRAPH}/{path}", data, {"Content-Type": "application/x-www-form-urlencoded"}, raw=True)
    out = json.loads(content or b"{}")
    if status >= 300 or "error" in out:
        raise RuntimeError(f"meta {path.split('/')[-1]}: {out.get('error', {}).get('message', status)}")
    return out


def post_facebook(image_url, caption):
    r = graph("POST", f"{os.environ['META_PAGE_ID']}/photos", {"url": image_url, "caption": caption, "published": "true"})
    pid = r.get("post_id") or r["id"]
    return {"id": pid, "photo_id": r["id"], "url": f"https://www.facebook.com/{pid}"}


def post_instagram(image_url, caption):
    ig = os.environ.get("IG_USER_ID")
    c = graph("POST", f"{ig}/media", {"image_url": image_url, "caption": caption})
    for _ in range(12):  # wait (up to ~1 min) for Instagram to finish processing the image
        st = json.loads(http("GET", f"{GRAPH}/{c['id']}?fields=status_code&access_token={os.environ['META_PAGE_TOKEN']}")[1] or b"{}")
        if st.get("status_code") == "FINISHED":
            break
        if st.get("status_code") == "ERROR":
            raise RuntimeError("instagram could not process the image")
        time.sleep(5)
    r = graph("POST", f"{ig}/media_publish", {"creation_id": c["id"]})
    try:
        link = json.loads(http("GET", f"{GRAPH}/{r['id']}?fields=permalink&access_token={os.environ['META_PAGE_TOKEN']}")[1]).get("permalink")
    except Exception:
        link = None
    return {"id": r["id"], "url": link or "https://www.instagram.com/"}


def yt_ok():
    return all(os.environ.get(k) for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"))


def yt_token():
    data = urllib.parse.urlencode({
        "client_id": os.environ["YT_CLIENT_ID"], "client_secret": os.environ["YT_CLIENT_SECRET"],
        "refresh_token": os.environ["YT_REFRESH_TOKEN"], "grant_type": "refresh_token",
    }).encode()
    status, content, _ = http("POST", "https://oauth2.googleapis.com/token", data, {"Content-Type": "application/x-www-form-urlencoded"}, raw=True)
    if status != 200:
        raise RuntimeError(f"youtube token: {status} {content[:200]!r}")
    return json.loads(content)["access_token"]


def post_youtube(video_path, p, caption):
    tok = yt_token()
    title = f"{p.get('title', 'NARTHA saree')} · virtual try-on #Shorts"[:100]
    meta = {
        "snippet": {"title": title, "description": caption[:4900], "tags": ["NARTHA", "saree", "cotton saree", "virtual try-on"], "categoryId": "26"},
        "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
    }
    status, content, headers = http(
        "POST", "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", meta,
        {"Authorization": f"Bearer {tok}", "X-Upload-Content-Type": "video/mp4"})
    if status >= 300:
        raise RuntimeError(f"youtube start: {status} {content[:200]!r}")
    data = Path(video_path).read_bytes()
    status, content, _ = http("PUT", headers["Location"], data, {"Authorization": f"Bearer {tok}", "Content-Type": "video/mp4"}, raw=True, timeout=600)
    if status >= 300:
        raise RuntimeError(f"youtube upload: {status} {content[:200]!r}")
    vid = json.loads(content)["id"]
    return {"id": vid, "url": f"https://youtube.com/shorts/{vid}"}


def take_down(channel, post):
    """Delete a live post. Returns True when it's gone (or there was nothing to delete)."""
    if not post or not post.get("id"):
        return True
    if channel == "facebook" and meta_ok():
        graph("DELETE", post["id"], {})
        return True
    if channel == "instagram" and meta_ok():
        graph("DELETE", post["id"], {})  # Instagram's API may refuse this; the admin page then says to remove it by hand.
        return True
    if channel == "youtube" and yt_ok():
        status, content, _ = http("DELETE", f"https://www.googleapis.com/youtube/v3/videos?id={post['id']}", headers={"Authorization": f"Bearer {yt_token()}"})
        if status in (204, 404):
            return True
        raise RuntimeError(f"youtube delete: {status}")
    return False


# ---------------------------------------------------------------- main loop
def run():
    if not KEY:
        print("::warning::SUPABASE_SERVICE_ROLE_KEY secret is not set yet, so nothing was published.")
        return
    cfg = rest("GET", "share_config?select=*")[0]
    products = catalog()
    available = {"facebook": meta_ok(), "instagram": meta_ok() and bool(os.environ.get("IG_USER_ID")), "youtube": yt_ok()}
    channels = [c for c in cfg["channels"] if available.get(c)]
    missing = [c for c in cfg["channels"] if not available.get(c)]
    if missing:
        print(f"! channels without credentials (skipped): {', '.join(missing)}")

    # 1. take-downs
    for s in rest("GET", "shares?select=id,posts,post_image_path,status&status=in.(withdrawn,rejected)&posts=neq.{}"):
        posts, left = dict(s["posts"]), {}
        if all(v.get("manual_removal") for v in posts.values()) and not s["post_image_path"]:
            continue  # already flagged on the admin page; nothing more we can do automatically
        for ch, post in posts.items():
            if post.get("manual_removal"):
                left[ch] = post
                continue
            try:
                if not take_down(ch, post):
                    left[ch] = {**post, "manual_removal": True}
            except Exception as e:
                print(f"  take-down {ch} failed for {s['id']}: {e}")
                left[ch] = {**post, "manual_removal": True}
        storage_delete("share-media", [f"{s['id']}/post.jpg", f"{s['id']}/short.mp4"])
        update_share(s["id"], {"posts": left, "post_image_path": None})
        print(f"- took down {s['id']} ({s['status']}); still to remove by hand: {list(left) or 'none'}")

    # 2. publishing
    statuses = "approved,pending" if cfg["auto_publish"] else "approved"
    queue = rest("GET", f"shares?select=*&status=in.({statuses})&attempts=lt.{MAX_ATTEMPTS}&order=created_at.asc&limit=50")
    done = 0
    for s in queue:
        todo = [c for c in channels if c not in (s["posts"] or {})]
        if s["post_image_path"] and not todo:
            continue  # composed already, nothing new to post (queue-only mode)
        if done >= cfg["max_posts_per_run"]:
            break
        done += 1
        p = products.get(s["handle"], {"title": "NARTHA saree", "images": []})
        fields = {}
        try:
            if s["status"] == "pending":
                fields.update(status="approved", reviewed_by="auto", reviewed_at=now_iso())
            result = Image.open(BytesIO(storage_get("tryons", s["result_path"]))).convert("RGB")
            prod = fetch_image(p["images"][0]) if p.get("images") else result
            caption = caption_for(cfg, p, s["handle"])
            image_url = storage_put("share-media", f"{s['id']}/post.jpg", jpeg_bytes(compose_post(result, prod, p)), "image/jpeg")
            fields.update(post_image_path=f"{s['id']}/post.jpg", caption=caption)
            posts = dict(s["posts"] or {})
            errors = []
            for ch in todo:
                try:
                    if ch == "facebook":
                        posts[ch] = post_facebook(image_url, caption)
                    elif ch == "instagram":
                        posts[ch] = post_instagram(image_url, caption)
                    elif ch == "youtube":
                        with tempfile.TemporaryDirectory() as tmp:
                            vid = Path(tmp, "short.mp4")
                            make_short(compose_short_frames(result, prod, p), vid)
                            posts[ch] = post_youtube(vid, p, caption)
                    print(f"  {ch}: {posts[ch]['url']}")
                except Exception as e:
                    errors.append(f"{ch}: {e}")
            fields["posts"] = posts
            if errors:
                fields.update(attempts=s["attempts"] + 1, publish_error="; ".join(errors)[:500])
            else:
                fields["publish_error"] = None
                if channels:
                    fields.update(status="published", published_at=now_iso())
            print(f"+ {s['id']} {p.get('title')}: {'posted' if channels and not errors else 'ready'}{' with errors' if errors else ''}")
        except Exception as e:
            fields.update(attempts=s["attempts"] + 1, publish_error=str(e)[:500])
            print(f"! {s['id']}: {e}")
        # Don't overwrite a withdrawal that happened while we were working on it.
        rest("PATCH", f"shares?id=eq.{s['id']}&status=in.(pending,approved)", fields, prefer="return=minimal")
    print(f"done: {done} processed, channels={channels or 'none (queue only)'}")


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def preview(result_path, handle, outdir):
    p = catalog().get(handle)
    if not p:
        sys.exit(f"unknown handle {handle}")
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    result = Image.open(result_path).convert("RGB")
    prod = fetch_image(p["images"][0])
    compose_post(result, prod, p).save(out / "post.jpg", quality=90)
    a, b = compose_short_frames(result, prod, p)
    a.save(out / "short-1.jpg", quality=88); b.save(out / "short-2.jpg", quality=88)
    try:
        make_short((a, b), out / "short.mp4")
    except Exception as e:
        print("ffmpeg:", e)
    cfg_default = {"site_url": "https://icsmartbanana.github.io/nartha-store/",
                   "caption_template": "{title} ✨\nVirtually tried on at NARTHA. Handcrafted cotton, ₹{price}.\n\nTry it on yourself: {url}\n\n#NARTHA #CottonSaree #Handloom #SareeLove #VirtualTryOn"}
    (out / "caption.txt").write_text(caption_for(cfg_default, p, handle), encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "--preview":
        preview(*sys.argv[2:])
    else:
        run()
