# Fixing the Stripe webhook (make payments actually grant Premium)

## The problem in one sentence
Stripe is calling your Supabase function, but Supabase's gateway **rejects the call with 401**
because the function is set to require a Supabase login token — which Stripe can't send. So a
completed payment never sets the user's `plan`. (Confirmed: the webhook has had **0 successful
deliveries**, and the current `premium` accounts are all from promo codes.)

## The fix in one sentence
Redeploy the `stripe-webhook` function with **JWT verification turned OFF** (`verify_jwt = false`).
Then the gateway lets Stripe through, and the function still verifies the real Stripe signature —
so it stays secure. This also puts the function's code into your repo for the first time.

You do this once, from Terminal on your Mac. ~10 minutes.

---

## Step 1 — Install the Supabase CLI
```bash
brew install supabase/tap/supabase
```
Then confirm it's there:
```bash
supabase --version
```
> No Homebrew? Use `npm install -g supabase` instead (needs Node.js).

## Step 2 — Log in to Supabase
```bash
supabase login
```
A browser tab opens → click **Authorize**. Terminal will say you're logged in.

## Step 3 — Go to the repo (the function files are already here)
```bash
cd /Users/aidanlee/the-depth-chart
git pull
```
You now have `supabase/config.toml` and `supabase/functions/stripe-webhook/index.ts`.
`config.toml` already contains `verify_jwt = false` for this function.

## Step 4 — Link the CLI to your project
```bash
supabase link --project-ref izlqhnxowdhtdofkwrho
```
> If it asks for a **database password**, just press **Enter** to skip — deploying a function
> doesn't need it. (It's under Dashboard → Project Settings → Database if it ever insists.)

## Step 5 — Deploy with JWT verification OFF
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```
Wait for **"Deployed Function stripe-webhook"**.

> You do **not** need to re-enter any secrets. `STRIPE_WEBHOOK_SECRET` and `NEW_SERVICE_KEY`
> stay set on the project across deploys.

## Step 6 — Confirm the pipe is open
Tell Claude "deployed" and it will re-probe from the outside. The proof: an unauthenticated POST
now returns **400 (signature check)** instead of **401 (gateway block)** — meaning Stripe's calls
now reach the function.

## Step 7 — Real end-to-end test (optional but definitive)
Your Premium Stripe links are **live**, so a test is a real **$4.99** charge (refundable in Stripe
afterward: Payments → the charge → Refund).
1. Sign up / sign in on the site with an email you control.
2. Pricing → **Get Premium** → complete checkout **with that same email**.
3. Tell Claude the email; it will check whether `profiles.plan` flipped to `premium`.

---

## Troubleshooting
- **`command not found: supabase`** → CLI didn't install or isn't on PATH. Re-run Step 1, open a
  new Terminal window.
- **Deploy mentions Docker** → update the CLI: `brew upgrade supabase`. Function deploys don't need Docker.
- **Re-probe still shows 401 after deploy** → the flag didn't take. Check
  `supabase/config.toml` has `verify_jwt = false` under `[functions.stripe-webhook]`, and redeploy.
- **404 "User not found" on a real purchase** → the payment email didn't match a site account
  email. Check out with the same email you signed up with.

## After this works — Phase 2 (before selling Pro/Coach)
The function currently hardcodes `plan = 'premium'` and ignores cancellations. Before the Pro/Coach
links go live, it needs: a `price_id → plan` map, and a `customer.subscription.deleted` handler that
sets `plan = 'free'` (plus subscribing the Stripe endpoint to that event). Claude will do this once
you have the Stripe **Price IDs**.
