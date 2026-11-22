# NARTHA storefront + virtual try-on

A custom front end for [nartha.in](https://www.nartha.in). Products come from the Shopify store; checkout stays on Shopify.

## How it fits together
| Part | Where | Notes |
|---|---|---|
| Storefront (this repo) | GitHub Pages | Static HTML/CSS/JS, hash routes: `#/`, `#/shop`, `#/c/<collection>`, `#/p/<product>` |
| Catalogue | `data/catalog.json` | Built by `scripts/sync.py` from the store's public feed; refreshed nightly by GitHub Actions (`Sync catalogue`), or run it manually from the Actions tab |
| Bag & checkout | Shopify | Bag lives in the browser; *Checkout* sends the customer to `nartha.in/cart/<variant>:<qty>?storefront=true`, which fills the nartha.in cart and opens the cart page, where the store's Shiprocket checkout takes over (same as buying on nartha.in) |
| Try-on | Supabase project `nartha-store` | Email sign-in + edge function `tryon` that holds the image-API key |

## Try-on limits (enforced on the server)
- Signed-in users only (email code).
- **3 try-ons per user per rolling 7 days** — `WEEKLY_LIMIT` secret, plus any extra try-ons earned by sharing a look.
- **100 try-ons per day across the whole site** — `DAILY_CAP` secret (budget kill switch).
- `TRYON_ENABLED=false` pauses try-on instantly.
- Same photo + same saree returns the saved result without using a try-on.
- Failed generations don't count.
- Out-of-stock sarees can't be tried on.
- Photos are resized to 1024px in the browser before upload.

Each try-on sends the customer photo + the product's two images (model shot and the body/pallu/blouse detail collage).

## Customer contacts and consent
- The try-on sign-in asks for email, an optional mobile number (+91) and an **unticked** checkbox: "Send me new arrivals and offers on WhatsApp and email. I can turn this off anytime."
- Signed-in customers who were never asked see a one-time "Stay in the loop" card; everyone sees an on/off link under the try-on.
- Data lives in Supabase: `contacts` (current state per customer) and `consent_log` (every opt-in/opt-out with time, wording and source). Writes go only through `save_contact()`; customers can read only their own rows. Schema: `supabase/migrations/20261122000000_contacts_consent.sql`.
- Mobile numbers are **not verified** (`phone_verified = false`).
- Export opted-in customers (SQL editor): `select email, phone, consent_channels, consent_at from contacts where marketing_consent order by consent_at desc;`

## Share your look (customer try-ons on NARTHA's social pages)
- After a try-on, customers can tick two unticked boxes (permission to post the try-on image without their name, and "I'm the person in this photo and 18+") and tap **Share my look**. Their original photo is never posted.
- Sharing adds **1 extra try-on**, at most once a day, valid 7 days (`share_config.daily_bonus`). Customers can remove a share anytime ("Your shared looks" in the try-on window).
- **Review queue:** open `#/admin` on the site and sign in with an email listed in the `share_admins` table. Approve, reject, un-approve or take down. Nothing is posted until it's approved, unless `auto_publish` is on.
- **Posting:** the GitHub Action *Publish shared try-ons* runs every 30 minutes (or run it from the Actions tab). For each approved share it builds a 1080×1350 post image (plus a 1080×1920 Short for YouTube), uploads it to the public `share-media` bucket, and posts it to each channel that is switched on. Removed or rejected posts are deleted from the channels. Where a channel won't allow deletion through its API (possibly Instagram), the admin page tells you to remove it by hand.
- **Settings** (Supabase → Table editor → `share_config`, one row):
  | Column | Meaning |
  |---|---|
  | `enabled` | Show the share option to customers |
  | `channels` | Any of `instagram`, `facebook`, `youtube`. Empty = queue only: approved shares get a post image and caption to post by hand |
  | `auto_publish` | `false` (default) = every share waits for approval |
  | `daily_bonus` | Extra try-ons per day for sharing (0 turns the reward off) |
  | `max_posts_per_run` | Posting pace: at most this many posts every 30 minutes |
  | `caption_template` | Uses `{title}`, `{price}`, `{url}`, `{type}` |
  | `site_url` | Where `{url}` points |
- **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
  | Secret | For |
  |---|---|
  | `SUPABASE_SERVICE_ROLE_KEY` | Required. Supabase → Project Settings → API keys → secret key |
  | `META_PAGE_ID`, `META_PAGE_TOKEN` | Facebook Page (a long-lived Page access token with `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`, `instagram_basic`) |
  | `IG_USER_ID` | The Instagram professional account connected to that Page |
  | `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | YouTube channel, OAuth with the `youtube.upload` scope. Google keeps uploads from unverified apps private until the app passes its audit |
  A channel listed in `channels` without its secrets is skipped, and the run log says so.
- Preview the post design locally: `python scripts/publish_shares.py --preview result.png <product-handle> out/`
- Schema: `supabase/migrations/20261123000000_shares.sql`.

## Supabase secrets (Dashboard → Edge Functions → Secrets)
- `OPENAI_API_KEY` — required
- `OPENAI_IMAGE_MODEL` — default `gpt-image-1`; set to the newest GPT Image model
- `OPENAI_IMAGE_QUALITY` — `low` / `medium` (default) / `high`
- `WEEKLY_LIMIT`, `DAILY_CAP`, `TRYON_ENABLED`

## Auth settings (Dashboard → Authentication → URL Configuration)
Set **Site URL** and add a **Redirect URL** for the GitHub Pages address so email links come back to the site.
For production, add your own SMTP (Authentication → Emails) — Supabase's built-in sender is limited to a few emails per hour.
