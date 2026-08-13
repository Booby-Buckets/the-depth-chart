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
// KNOWN LIMITATIONS (Phase 2):
//   • no cancellation handling — add a 'customer.subscription.deleted' branch that
//     sets plan='free' (and subscribe the endpoint to that event in Stripe).
//   • client_reference_id is client-set: a user could in theory pay the cheaper Premium
//     price but stamp a Pro planKey. To fully harden, add the Stripe secret key and
//     verify the paid price server-side (fetch the session's line_items) before granting.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const SUPABASE_URL = 'https://izlqhnxowdhtdofkwrho.supabase.co'
const SUPABASE_SERVICE_KEY = Deno.env.get('NEW_SERVICE_KEY')!

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

    const plan = /pro/i.test(planKey) ? 'pro'
               : /coach/i.test(planKey) ? 'coach'
               : 'premium'
    // Interval from the plan key; fall back to amount for legacy sessions with no key.
    const isYearly = /year/i.test(planKey) || (!planKey && session.amount_total >= 5000)

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
      userId = userData?.users?.[0]?.id
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

    console.log(`✅ Upgraded ${email || userId} to ${plan} until ${expiry.toISOString()}`)
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
