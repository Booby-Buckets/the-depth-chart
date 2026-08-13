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
// KNOWN LIMITATIONS (Phase 2 — fix before selling Pro/Coach):
//   • plan is hardcoded to 'premium' — it can't grant 'pro'/'coach'. Needs a
//     price_id → plan map (read session.line_items / the subscription's price).
//   • no cancellation handling — add a 'customer.subscription.deleted' branch that
//     sets plan='free' (and subscribe the endpoint to that event in Stripe).
//   • monthly-vs-yearly is guessed from amount_total >= 5000; fine for Premium only.

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

    // Calculate expiry
    const expiry = new Date()
    const isYearly = session.amount_total >= 5000
    if (isYearly) {
      expiry.setFullYear(expiry.getFullYear() + 1)
    } else {
      expiry.setMonth(expiry.getMonth() + 1)
    }

    // Identify the account. PREFER client_reference_id — the site attaches the signed-in
    // user's id to checkout, so this is correct even if they paid with a DIFFERENT email
    // than their account. Fall back to email lookup only for older/legacy sessions.
    let userId = session.client_reference_id || null

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
          plan: 'premium',
          sub_expires_at: expiry.toISOString()
        })
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error('Failed to update profile:', err)
      return new Response('Failed to update profile', { status: 500 })
    }

    console.log(`✅ Upgraded ${email} (${userId}) to premium until ${expiry.toISOString()}`)
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
