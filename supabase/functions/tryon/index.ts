// NARTHA virtual try-on. Holds the image-API key server-side and enforces limits:
//  - signed-in users only
//  - WEEKLY_LIMIT try-ons per user per rolling 7 days (failed ones don't count)
//  - DAILY_CAP try-ons across the whole site per day (budget kill switch)
//  - same photo + same saree returns the saved result for free
import { createClient } from "npm:@supabase/supabase-js@2";

const STORE = Deno.env.get("STORE_URL") ?? "https://www.nartha.in";
const WEEKLY_LIMIT = Number(Deno.env.get("WEEKLY_LIMIT") ?? 3);
const DAILY_CAP = Number(Deno.env.get("DAILY_CAP") ?? 100);
const TRYON_ENABLED = (Deno.env.get("TRYON_ENABLED") ?? "true") !== "false";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const MODEL = Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-1";
const QUALITY = Deno.env.get("OPENAI_IMAGE_QUALITY") ?? "medium";
const MAX_PHOTO_BYTES = 2_500_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function prompt(title: string, type: string) {
  return `Virtual saree try-on of the saree "${title}"${type ? ` (${type})` : ""}. Image 1 is the customer. ` +
    `Image 2 shows a model wearing the saree — use it only for how the saree is worn and its overall colours; never copy the model, her face or her jewellery. ` +
    `If an image 3 is given, it is the fabric detail collage and is the exact reference for the textile: its panels show the saree body pattern, the pallu design and the blouse fabric (identify which panel is which). ` +
    `Dress the customer in this saree in Nivi style: the body and pleats use exactly the body pattern with its border, the pallu shows exactly the pallu design, and the short-sleeve blouse is stitched from exactly the blouse fabric. ` +
    `Match motif shapes, scale, spacing and colours precisely; do not invent or simplify patterns. Where image 2 and the collage disagree (for example the blouse), always follow the collage. ` +
    `Pleats tucked at the waist, slightly uneven and softly overlapping the way real handloom cotton falls, with small natural creases and a little volume at the hem — not stiff or perfectly symmetrical. ` +
    `The pallu goes over her left shoulder and is then brought forward and draped loosely over her left forearm, hanging in front of her body at her side so the full pallu design is clearly visible from the front. ` +
    `Reproduce the saree's exact colours, motifs, weave, border and pallu design faithfully; do not invent new patterns. ` +
    `Keep her face, glasses, hair, skin tone, body shape and size, feet, the background and everything in the room exactly as in image 1; only her left arm bends slightly to hold the pallu. ` +
    `Photorealistic phone photo, full body head to toe.`;
}

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signed(path: string) {
  const { data } = await admin.storage.from("tryons").createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  // Who is asking?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user || user.is_anonymous) return json({ error: "sign_in_required" }, 401);

  const body = await req.json().catch(() => null) as { action?: string; photo?: string; handle?: string } | null;

  // Quota check only
  if (body?.action === "status") {
    const { data } = await admin.from("tryons").select("created_at").eq("user_id", user.id)
      .neq("status", "failed").gt("created_at", new Date(Date.now() - 7 * 864e5).toISOString())
      .order("created_at", { ascending: true });
    const used = data?.length ?? 0;
    const reset = data?.[0] ? new Date(new Date(data[0].created_at).getTime() + 7 * 864e5).toISOString() : null;
    return json({ limit: WEEKLY_LIMIT, used, remaining: Math.max(0, WEEKLY_LIMIT - used), reset_at: reset, enabled: TRYON_ENABLED && !!OPENAI_KEY });
  }

  if (!TRYON_ENABLED) return json({ error: "paused" }, 503);
  if (!OPENAI_KEY) return json({ error: "not_configured" }, 503);
  if (!body?.photo || !body?.handle || !/^[\w\-\p{L}\p{N}%]+$/u.test(body.handle)) return json({ error: "bad_request" }, 400);

  const photo = Uint8Array.from(atob(body.photo.replace(/^data:image\/\w+;base64,/, "")), (c) => c.charCodeAt(0));
  if (photo.byteLength > MAX_PHOTO_BYTES) return json({ error: "photo_too_large" }, 413);

  // Product comes from the store itself, never from the browser.
  const pr = await fetch(`${STORE}/products/${body.handle}.js`);
  if (!pr.ok) return json({ error: "unknown_product" }, 404);
  const product = await pr.json();
  if (!product.available) return json({ error: "out_of_stock" }, 409);
  // Image 1 of every product is the worn shot, image 2 the body/pallu/blouse detail collage.
  const refUrls = ((product.images ?? []) as string[]).slice(0, 2).map((u) => u.replace(/^\/\//, "https://"));
  if (!refUrls.length) return json({ error: "no_product_image" }, 422);

  const hash = await sha256(new Uint8Array([...photo, ...new TextEncoder().encode("|" + body.handle + "|v3")]).buffer);

  // Same photo + same saree = free repeat.
  const { data: cached } = await admin.from("tryons").select("result_path").eq("user_id", user.id)
    .eq("input_hash", hash).eq("status", "done").limit(1).maybeSingle();
  if (cached?.result_path) return json({ image: await signed(cached.result_path), cached: true });

  const { data: r, error: rErr } = await admin.rpc("reserve_tryon", {
    p_user: user.id, p_handle: body.handle, p_hash: hash, p_weekly: WEEKLY_LIMIT, p_daily: DAILY_CAP,
  }).single();
  if (rErr) return json({ error: "server" }, 500);
  if (!r.ok) return json({ error: r.reason, reset_at: r.reset_at, limit: WEEKLY_LIMIT }, 429);

  try {
    const refs = await Promise.all(refUrls.map(async (u) =>
      (await fetch(u.includes("?") ? u + "&width=1024" : u + "?width=1024")).blob()));
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", prompt(product.title, product.type));
    form.append("image[]", new Blob([photo], { type: "image/jpeg" }), "customer.jpg");
    refs.forEach((b, i) => form.append("image[]", b, i === 0 ? "saree-worn.jpg" : "saree-detail.jpg"));
    form.append("size", "1024x1536");
    form.append("quality", QUALITY);
    const ai = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: form,
    });
    const out = await ai.json();
    const b64 = out?.data?.[0]?.b64_json;
    if (!ai.ok || !b64) throw new Error(out?.error?.message ?? `image api ${ai.status}`);

    const path = `${user.id}/${r.tryon_id}.png`;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await admin.storage.from("tryons").upload(path, bytes, { contentType: "image/png" });
    await admin.from("tryons").update({ status: "done", result_path: path }).eq("id", r.tryon_id);
    return json({ image: await signed(path), remaining: Math.max(0, WEEKLY_LIMIT - r.used), reset_at: r.reset_at });
  } catch (e) {
    // Failed attempts are refunded (they don't count toward the limit).
    await admin.from("tryons").update({ status: "failed", error: String(e).slice(0, 500) }).eq("id", r.tryon_id);
    return json({ error: "generation_failed" }, 502);
  }
});
