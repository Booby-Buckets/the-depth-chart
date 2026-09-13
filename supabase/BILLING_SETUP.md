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
