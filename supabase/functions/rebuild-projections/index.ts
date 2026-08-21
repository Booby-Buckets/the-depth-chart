// rebuild-projections — Supabase Edge Function. The owner console calls this to kick off
// the GitHub Actions "Rebuild projected DNA" workflow, which re-runs the Python builders
// against the LIVE rosters and commits team_dna.json / team_eff.json (Vercel then deploys).
//
// Why a function (not a direct GitHub call from the page): triggering a workflow needs a
// GitHub token with actions:write, which must NEVER ship in a static page. It lives here
// as a secret; the page only calls this function, and only the signed-in OWNER may.
//
// DEPLOY: supabase functions deploy rebuild-projections
//   (keep JWT verification ON — only logged-in users reach it; we additionally check the
//    caller's email is the owner. Mirrored by [functions.rebuild-projections] in config.toml.)
//
// SECRETS (Supabase -> Edge Functions -> Secrets; NOT in this file):
//   GH_DISPATCH_TOKEN   a GitHub fine-grained PAT scoped to Booby-Buckets/the-depth-chart
//                       with "Actions: read and write" (used to POST the workflow dispatch)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = 'https://izlqhnxowdhtdofkwrho.supabase.co'
const ANON = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'
const GH_TOKEN = Deno.env.get('GH_DISPATCH_TOKEN')!
const OWNER_EMAIL = 'blee4824@gmail.com'
const REPO = 'Booby-Buckets/the-depth-chart'
const WORKFLOW = 'rebuild-projections.yml'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // 1) identify the caller from their Supabase access token and require the owner
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in.' }, 401)
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  if (!who.ok) return json({ error: 'Invalid session.' }, 401)
  const user = await who.json().catch(() => null)
  const email = (user?.email || '').toLowerCase()
  if (email !== OWNER_EMAIL) return json({ error: 'Owner only.' }, 403)

  // 2) trigger the GitHub Actions workflow on main
  if (!GH_TOKEN) return json({ error: 'GH_DISPATCH_TOKEN not configured on the server.' }, 500)
  const gh = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tdc-owner-console',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  })
  if (gh.status !== 204) {
    const detail = await gh.text().catch(() => '')
    return json({ error: `GitHub dispatch failed (${gh.status}). ${detail}`.trim() }, 502)
  }
  return json({ ok: true, runsUrl: `https://github.com/${REPO}/actions/workflows/${WORKFLOW}` })
})
