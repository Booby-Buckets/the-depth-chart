// stripe-webhook — Supabase Edge Function. Stripe calls this after a successful
// checkout; it verifies the Stripe signature and upgrades the user's profiles.plan.
//
// DEPLOY: supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt is REQUIRED — Stripe cannot send a Supabase auth header, so the
//    gateway must not demand one. The function verifies the Stripe signature instead.
//    Mirrored by [functions.stripe-webhook] verify_jwt = false in supabase/config.toml.)
//
// SECRETS (set in Supabase → Edge Functions → Secrets; NOT in this file):
//   STRIPE_WEBHOOK_SECRET   the whsec_… from the Stripe webhook endpoint
//   NEW_SERVICE_KEY         the Supabase service_role key (bypasses RLS to set plan)
//
// Tier + interval come from client_reference_id "<userId>__<planKey>" stamped by the
// site at checkout (planKey: monthly|yearly|pro_monthly|pro_yearly) — so plan is granted
// correctly per tier without a Stripe price lookup.
//
// PHASE 2 (lifecycle) — needs the optional STRIPE_SECRET_KEY secret and the Stripe endpoint
// subscribed to these events:
//   • customer.subscription.updated  → plan re-derived from the PAID price (Premium ⇄ Pro
//     switches made in the Customer Portal), sub_expires_at = current period end; a
//     subscription set to cancel at period end keeps its plan until then.
//   • customer.subscription.deleted  → plan = the best subscription this ACCOUNT still has live (every Stripe
//     customer tied to it by metadata.tdc_user_id or email — Payment Links make a new customer per purchase),
//     'free' only when none is left. (Oct 2026: cancelling a member's duplicate subscriptions must not
//     downgrade the one they kept.)
//   • checkout.session.completed     → when the secret key is present the paid price is
//     verified server-side (line_items) and overrides the client-stamped planKey, closing
//     the "pay Premium, stamp Pro" hole. Without the key it behaves exactly as before.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''     // optional: enables Phase 2
const SUPABASE_URL = 'https://izlqhnxowdhtdofkwrho.supabase.co'
const SUPABASE_SERVICE_KEY = Deno.env.get('NEW_SERVICE_KEY')!

const stripeGet = (path: string) => fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }).then(r => r.json())
// Tier from what was actually paid: Premium is $4.99 / $50, Pro is $8.99 / $89.99 — anything
// priced at or above Pro's monthly/yearly floor is Pro. (Cents.)
function planFromPrice(unit_amount: number | null | undefined, interval: string | null | undefined): 'premium' | 'pro' | null {
  if (unit_amount == null) return null
  const yearly = interval === 'year'
  return unit_amount >= (yearly ? 8000 : 700) ? 'pro' : 'premium'
}
const stripePost = (path: string, form: Record<string, string>) => fetch(`https://api.stripe.com/v1/${path}`, {
  method: 'POST', headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(form) }).then(r => r.json())
// EXACT email match only. The admin users endpoint may ignore the ?email= filter and return the
// first page of all users, so never fall back to users[0] — that would grant/revoke a stranger's plan.
async function userIdByEmail(email: string): Promise<string | null> {
  if (!email) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } })
  const d = await r.json()
  const u = (d?.users || []).find((x: any) => (x.email || '').toLowerCase() === email.toLowerCase())
  return u?.id || null
}
// Account link that survives a different payment email: checkout stamps the Stripe customer with
// metadata.tdc_user_id. Lifecycle events resolve the user from that, then from the subscription's
// own checkout session (client_reference_id), and only last by email.
const refUser = (ref: string | null | undefined) => { const r = ref || ''; const i = r.indexOf('__'); return (i > -1 ? r.slice(0, i) : r) || null }
async function userIdForSubscription(sub: any): Promise<{ userId: string | null, email: string }> {
  let email = ''
  try {
    const c = await stripeGet(`customers/${sub.customer}`)
    email = c?.email || ''
    if (c?.metadata?.tdc_user_id) return { userId: c.metadata.tdc_user_id, email }
  } catch (_) { /* fall through */ }
  try {
    const cs = await stripeGet(`checkout/sessions?subscription=${encodeURIComponent(sub.id)}&limit=1`)
    const uid = refUser(cs?.data?.[0]?.client_reference_id)
    if (uid) { stripePost(`customers/${sub.customer}`, { 'metadata[tdc_user_id]': uid }).catch(() => {}); return { userId: uid, email } }
  } catch (_) { /* fall through */ }
  return { userId: await userIdByEmail(email), email }
}
// Every live subscription this account has, across all of its Stripe customers → the best plan + latest period end.
const LIVE = ['active', 'trialing', 'past_due']
async function bestLivePlan(userId: string, email: string, extraCustomer?: string): Promise<{ plan: 'premium' | 'pro' | null, periodEnd: string | null, n: number }> {
  const custs = new Set<string>()
  if (extraCustomer) custs.add(extraCustomer)
  try { const r = await stripeGet(`customers/search?query=${encodeURIComponent(`metadata['tdc_user_id']:'${userId}'`)}&limit=100`); (r?.data || []).forEach((c: any) => custs.add(c.id)) } catch (_) { /* search may be unavailable */ }
  if (email) { try { const r = await stripeGet(`customers?email=${encodeURIComponent(email)}&limit=100`); (r?.data || []).forEach((c: any) => custs.add(c.id)) } catch (_) { /* ignore */ } }
  let best: 'premium' | 'pro' | null = null, end = 0, n = 0
  for (const c of custs) {
    let subs: any[] = []
    try { subs = (await stripeGet(`subscriptions?customer=${c}&status=all&limit=100`))?.data || [] } catch (_) { continue }
    for (const sub of subs) {
      if (!LIVE.includes(sub.status)) continue
      const price = sub.items?.data?.[0]?.price, plan = planFromPrice(price?.unit_amount, price?.recurring?.interval)
      if (!plan) continue
      n++
      if (best !== 'pro' && (plan === 'pro' || !best)) best = plan
      end = Math.max(end, sub.current_period_end || 0)
    }
  }
  return { plan: best, periodEnd: end ? new Date(end * 1000).toISOString() : null, n }
}
async function setPlan(userId: string, plan: string, expiresIso: string | null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(expiresIso ? { plan, sub_expires_at: expiresIso } : { plan }),
  })
  if (!res.ok) throw new Error(await res.text())
}

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  // Verify webhook signature
  let event
  try {
    event = await verifyStripeSignature(body, signature!, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return new Response('Webhook signature verification failed', { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const email = session.customer_details?.email || session.customer_email

    // client_reference_id is "<userId>__<planKey>" (planKey = monthly | yearly |
    // pro_monthly | pro_yearly), stamped by the site at checkout. Derive the account,
    // the tier, and the billing interval from it — no price lookup needed.
    const ref = session.client_reference_id || ''
    const sep = ref.indexOf('__')
    let userId = sep > -1 ? ref.slice(0, sep) : (ref || null)
    const planKey = sep > -1 ? ref.slice(sep + 2) : ''

    let plan = /pro/i.test(planKey) ? 'pro'
             : /coach/i.test(planKey) ? 'coach'
             : 'premium'
    // Interval from the plan key; fall back to amount for legacy sessions with no key.
    let isYearly = /year/i.test(planKey) || (!planKey && session.amount_total >= 5000)
    // Harden: with the secret key, the PAID price decides the tier, not the client stamp.
    if (STRIPE_SECRET_KEY && session.id) {
      try {
        const li = await stripeGet(`checkout/sessions/${session.id}/line_items?limit=1`)
        const price = li?.data?.[0]?.price
        const paid = planFromPrice(price?.unit_amount, price?.recurring?.interval)
        if (paid && plan !== 'coach' && paid !== plan) { console.warn(`plan stamp ${plan} != paid ${paid}; using paid`); plan = paid }
        if (price?.recurring?.interval) isYearly = price.recurring.interval === 'year'
      } catch (e) { console.warn('line_items lookup failed', e) }
    }

    const expiry = new Date()
    if (isYearly) {
      expiry.setFullYear(expiry.getFullYear() + 1)
    } else {
      expiry.setMonth(expiry.getMonth() + 1)
    }

    // Fall back to email lookup only for older/legacy sessions with no client_reference_id.
    if (!userId) {
      if (!email) {
        return new Response('No client_reference_id or email', { status: 400 })
      }
      const userRes = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          }
        }
      )
      const userData = await userRes.json()
      userId = (userData?.users || []).find((x: any) => (x.email || '').toLowerCase() === email.toLowerCase())?.id || null
    }

    if (!userId) {
      console.error('No user found for checkout session:', email, session.client_reference_id)
      return new Response('User not found', { status: 404 })
    }

    // Update profile by user id
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          plan: plan,
          sub_expires_at: expiry.toISOString()
        })
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error('Failed to update profile:', err)
      return new Response('Failed to update profile', { status: 500 })
    }

    // Tie the Stripe customer to this account so the portal + cancellations find it even when
    // the payment email differs from the sign-in email.
    if (STRIPE_SECRET_KEY && session.customer) {
      try { await stripePost(`customers/${session.customer}`, { 'metadata[tdc_user_id]': userId }) } catch (e) { console.warn('customer metadata stamp failed', e) }
    }

    console.log(`✅ Upgraded ${email || userId} to ${plan} until ${expiry.toISOString()}`)
  }

  // ── Phase 2: subscription lifecycle (portal cancellations + plan switches, renewals) ──
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    if (!STRIPE_SECRET_KEY) { console.warn('subscription event ignored: STRIPE_SECRET_KEY not set'); return new Response(JSON.stringify({ received: true, ignored: true }), { headers: { 'Content-Type': 'application/json' } }) }
    const { userId, email } = await userIdForSubscription(sub)
    if (!userId) { console.error('subscription event: no user for', sub.customer, email); return new Response('User not found', { status: 404 }) }
    // the account's plan = its best LIVE subscription across every Stripe customer it has, so cancelling one of
    // several (duplicates bought by mistake) never downgrades the one it keeps; free only when nothing is live
    const live = await bestLivePlan(userId, email, sub.customer)
    if (live.plan) {
      await setPlan(userId, live.plan, live.periodEnd)
      console.log(`🔁 ${email} → ${live.plan} until ${live.periodEnd} (${live.n} live subscription${live.n === 1 ? '' : 's'}; ${event.type} ${sub.id} ${sub.status}${sub.cancel_at_period_end ? ', cancels at period end' : ''})`)
    } else {
      await setPlan(userId, 'free', new Date().toISOString())
      console.log(`⛔ ${email} → free (no live subscription left; ${event.type}, ${sub.status})`)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})

// Verify Stripe webhook signature using Web Crypto API
async function verifyStripeSignature(payload: string, header: string, secret: string) {
  const parts = header.split(',')
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1]
  const signature = parts.find(p => p.startsWith('v1='))?.split('=')[1]

  if (!timestamp || !signature) throw new Error('Invalid signature header')

  const signedPayload = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')

  if (expected !== signature) throw new Error('Signature mismatch')

  return JSON.parse(payload)
}
