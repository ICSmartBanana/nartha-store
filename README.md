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
- **3 try-ons per user per rolling 7 days** — `WEEKLY_LIMIT` secret.
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

## Supabase secrets (Dashboard → Edge Functions → Secrets)
- `OPENAI_API_KEY` — required
- `OPENAI_IMAGE_MODEL` — default `gpt-image-1`; set to the newest GPT Image model
- `OPENAI_IMAGE_QUALITY` — `low` / `medium` (default) / `high`
- `WEEKLY_LIMIT`, `DAILY_CAP`, `TRYON_ENABLED`

## Auth settings (Dashboard → Authentication → URL Configuration)
Set **Site URL** and add a **Redirect URL** for the GitHub Pages address so email links come back to the site.
For production, add your own SMTP (Authentication → Emails) — Supabase's built-in sender is limited to a few emails per hour.
