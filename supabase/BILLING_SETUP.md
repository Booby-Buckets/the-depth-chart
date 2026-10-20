# Billing Phase 2 — cancel / switch plans (one-time setup)

The site now has a **Manage subscription** panel (account page, profile → Account tab, pricing
page when signed in) with Manage / Switch plan / Cancel buttons. They open Stripe's Customer
Portal through the `stripe-portal` Edge Function, and the webhook now syncs cancellations and
plan switches back to `profiles.plan`. Three things to do once:

## 1. Add the Stripe secret key to Supabase
Stripe → Developers → API keys → copy the **Secret key** (`sk_live_…`).
Supabase → Edge Functions → Secrets → add `STRIPE_SECRET_KEY` = that key.

## 2. Deploy both functions (from the repo root, with the standalone CLI)
```bash
~/supabase functions deploy stripe-portal
```
```bash
~/supabase functions deploy stripe-webhook --no-verify-jwt
```
(`--no-verify-jwt` on the webhook is required — see STRIPE_WEBHOOK_FIX.md.)

## 3. Turn on the portal + the lifecycle events in Stripe
- Stripe → Settings → Billing → **Customer portal**: enable *Cancel subscriptions* (at period
  end) and *Switch plans*; add the Premium and Pro prices (monthly + yearly) to the switchable
  products; save.
- Stripe → Developers → Webhooks → your endpoint → **add events**
  `customer.subscription.updated` and `customer.subscription.deleted`
  (keep `checkout.session.completed`).

## 4. One subscription per customer (Oct 2026 — a member bought the same plan 6 times)
The site now refuses to open checkout for an account that already has a paid plan (it opens Manage subscription
instead) and warns before a second checkout within 45 minutes. Stripe's own setting is the backstop for anyone
who reaches a payment link directly:
**Stripe Dashboard → Settings → Payments → Checkout and Payment Links → Subscriptions → "Limit customers to one
subscription"** → turn it on. Stripe then recognises a returning customer by email and sends them to the customer
portal instead of charging again. (Requires the customer portal from step 3.)

## 5. Send customers back to the site after paying
Stripe → **Payment Links** → open each of the 4 links (Premium monthly/yearly, Pro monthly/yearly) → **After payment** →
"Don't show confirmation page" → **Redirect customers to your website** →
`https://www.thedepthchartcbb.com/account.html?checkout=success` → Save. The site shows "Payment received — unlocking your
plan…" and confirms when the plan is on (tdc-billing.js returnBanner).

## What happens after
- Cancel in the portal → Stripe fires `customer.subscription.updated` with
  `cancel_at_period_end` (plan kept, `sub_expires_at` = period end), then
  `customer.subscription.deleted` at the end → `plan = 'free'`.
- Switch Premium ⇄ Pro → `customer.subscription.updated` → the plan is re-derived from the
  **paid price** (≥ $7/mo or ≥ $80/yr = Pro).
- New checkouts: with the secret key present the webhook verifies the paid price and
  overrides the client-stamped plan (closes the "pay Premium, stamp Pro" hole).

## Fallback while step 1–2 aren't done
The buttons show "Plan changes aren't self-serve yet — email us" with a mailto. Optionally
paste Stripe's no-code portal login link (Customer portal → *Activate link*,
`https://billing.stripe.com/p/login/…`) into `PORTAL_LOGIN` in `tdc-billing.js` to make the
buttons work without the function (the member enters their email and gets a magic link).
