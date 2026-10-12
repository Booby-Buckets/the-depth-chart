// stripe-portal — Supabase Edge Function. Opens the Stripe Customer Portal for the signed-in
// user so they can cancel, switch Premium ⇄ Pro, change interval, or update their card.
//
//   POST /functions/v1/stripe-portal   (Authorization: Bearer <user JWT>)  body: { return_url? }
//   → { url }  redirect the browser there.   404 { error:'no_customer' } if no Stripe customer is
//     linked to the account (by tdc_user_id metadata, email, or a checkout stamped with the id).
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

  // Find the Stripe customer for THIS account. Members often pay with a different email than they
  // sign in with, so email is only a fallback:
  //   1. customer.metadata.tdc_user_id (stamped by stripe-webhook at checkout)
  //   2. the account email
  //   3. recent checkout sessions whose client_reference_id starts with the user id (purchases made
  //      before the metadata stamp existed) — and stamp the customer so next time is step 1.
  const uid = user?.id || ''
  let custId = ''
  if (uid) {
    const sr = await stripe(`customers/search?query=${encodeURIComponent(`metadata['tdc_user_id']:'${uid}'`)}&limit=1`)
    custId = (await sr.json())?.data?.[0]?.id || ''
  }
  if (!custId) {
    const cr = await stripe(`customers?email=${encodeURIComponent(email)}&limit=1`)
    custId = (await cr.json())?.data?.[0]?.id || ''
  }
  if (!custId && uid) {
    let after = ''
    for (let page = 0; page < 5 && !custId; page++) {
      const lr = await stripe(`checkout/sessions?limit=100${after ? `&starting_after=${after}` : ''}`)
      const list = await lr.json()
      const hit = (list?.data || []).find((cs: any) => cs.customer && (cs.client_reference_id || '').split('__')[0] === uid)
      if (hit) custId = hit.customer
      if (!list?.has_more || !list?.data?.length) break
      after = list.data[list.data.length - 1].id
    }
    if (custId) await stripe(`customers/${custId}`, { 'metadata[tdc_user_id]': uid })
  }
  if (!custId) return json({ error: 'no_customer' }, 404)

  const pr = await stripe('billing_portal/sessions', { customer: custId, return_url })
  const portal = await pr.json()
  if (!pr.ok || !portal?.url) { console.error('portal error', portal); return json({ error: 'portal_failed', detail: portal?.error?.message }, 502) }
  return json({ url: portal.url })
})
