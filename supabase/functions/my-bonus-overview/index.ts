// Repair 31 — the recruiter's bonus overview (presentation payload only).
// Reads with the service role, scoped to the CALLER's own service_lead resolved from the JWT
// (never from a request parameter), runs the same bonus engine as the app (lib/ = generated
// copies of src/lib), and returns ONLY bonus amounts + deal counts — no revenue, no deal
// amounts, no tier thresholds in shekels.
//
// Internal exception (QA parity only): when the bearer token is a service_role JWT — a
// secret no browser ever holds — `lead_name` may be supplied to compute another lead's
// overview server-side (optional `today`/`tiers` overrides exist for the same QA purpose).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { fetchBonusEvents } from './lib/bonus.ts'
import { buildBonusOverview } from './lib/bonusOverview.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const jerusalemToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())

// verify_jwt=true: the gateway has already validated the signature, so the role claim can be trusted.
const isServiceRoleJwt = (jwt: string): boolean => {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401)
    const token = authHeader.slice(7)

    const admin = createClient(url, serviceKey)
    let leadName: string
    let bonusModel: { tiers?: { min: number; bonus: number }[] } | null
    let today = jerusalemToday()

    if (isServiceRoleJwt(token)) {
      const body = await req.json().catch(() => ({}))
      leadName = String(body?.lead_name ?? '')
      if (!leadName) return json({ error: 'lead_name required' }, 400)
      if (typeof body?.today === 'string') today = body.today
      const { data: p } = await admin.from('profiles').select('bonus_model').ilike('full_name', leadName).maybeSingle()
      bonusModel = Array.isArray(body?.tiers) ? { tiers: body.tiers } : (p?.bonus_model ?? null)
    } else {
      const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
      const { data: me, error: meErr } = await userClient.auth.getUser()
      if (meErr || !me?.user) return json({ error: 'Invalid session' }, 401)
      const { data: p } = await admin.from('profiles').select('full_name, bonus_model').eq('id', me.user.id).single()
      if (!p?.full_name) return json({ error: 'Profile not found' }, 403)
      leadName = p.full_name
      bonusModel = p.bonus_model ?? null
    }

    const events = await fetchBonusEvents(admin as never, { leadName })
    const overview = buildBonusOverview(events, bonusModel?.tiers ?? [], today)
    // TEMPORARY (Repair 32 rollout): the previous UI build still reads `current`; removed once the new UI is live.
    const [yy, mm, dd] = today.split('-').map(Number)
    const legacy = {
      locked_bonus: overview.locked.bonus,
      locked_deals_count: overview.locked.deals_count,
      expected_this_month: { bonus_if_completed: overview.locked.bonus + overview.expected.bonus, deals_count: overview.expected.deals_count },
      next_tier: overview.next_tier ? { bonus: overview.next_tier.bonus, deals_needed: overview.next_tier.deals_to_tier_estimate } : null,
      days_left_in_month: Math.max(0, new Date(Date.UTC(yy, mm, 0)).getUTCDate() - dd),
    }
    return json({ ...overview, current: legacy })
  } catch (e) {
    console.error('my-bonus-overview error:', e)
    return json({ error: 'Internal error' }, 500)
  }
})
