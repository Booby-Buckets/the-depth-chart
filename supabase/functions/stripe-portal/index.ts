// stripe-portal — Supabase Edge Function. Opens the Stripe Customer Portal for the signed-in
// user so they can cancel, switch Premium ⇄ Pro, change interval, or update their card.
//
//   POST /functions/v1/stripe-portal   (Authorization: Bearer <user JWT>)  body: { return_url? }
//   → { url }  redirect the browser there.   404 { error:'no_customer' } if Stripe has no
//     customer with the account's email (they never paid — nothing to manage).
//
// DEPLOY:  supabase functions deploy stripe-portal      (verify_jwt stays ON — users only)
// SECRETS: STRIPE_SECRET_KEY  (sk_live_… — Supabase → Edge Functions → Secrets)
//
// The portal itself is configured once in Stripe → Settings → Billing → Customer portal:
// turn on "Cancel subscriptions" and "Switch plans" and list the Premium/Pro prices there.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''
const SUPABASE_URL = 'https://izlqhnxowdhtdofkwrho.supabase.co'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!STRIPE_SECRET_KEY) return json({ error: 'not_configured' }, 503)

  // Who is asking? Resolve the caller from their JWT via Supabase Auth.
  const auth = req.headers.get('authorization') || ''
  const apikey = req.headers.get('apikey') || ''
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey, Authorization: auth } })
  if (!ur.ok) return json({ error: 'unauthorized' }, 401)
  const user = await ur.json()
  const email = (user?.email || '').toLowerCase()
  if (!email) return json({ error: 'no_email' }, 400)

  let return_url = 'https://www.thedepthchartcbb.com/account.html'
  try { const b = await req.json(); if (b?.return_url && /^https:\/\/(www\.)?thedepthchartcbb\.com\//.test(b.return_url)) return_url = b.return_url } catch (_) { /* no body */ }

  const stripe = (path: string, form?: Record<string, string>) =>
    fetch(`https://api.stripe.com/v1/${path}`, {
      method: form ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
    })

  // Find the Stripe customer by the account email (Payment Links create the customer with it).
  const cr = await stripe(`customers?email=${encodeURIComponent(email)}&limit=1`)
  const cust = (await cr.json())?.data?.[0]
  if (!cust) return json({ error: 'no_customer' }, 404)

  const pr = await stripe('billing_portal/sessions', { customer: cust.id, return_url })
  const portal = await pr.json()
  if (!pr.ok || !portal?.url) { console.error('portal error', portal); return json({ error: 'portal_failed', detail: portal?.error?.message }, 502) }
  return json({ url: portal.url })
})
