// Repair 31 — saving a deal as a recruiter. A recruiter session can no longer read clients'
// billing terms or billing_events (accounting data), so the billing events for her deal are
// generated HERE, server-side, with the same engine the admin dialog runs in the browser
// (lib/dealEvents.ts = generated copy of src/lib/dealEvents.ts), then persisted through the
// unchanged save_transaction_with_events RPC *under the recruiter's own identity* — so its
// own-lead authorization still applies exactly as before.
//
// Response contains the saved id only — no events, no amounts.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildDealEvents } from './lib/dealEvents.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Keys the recruiter never sees (my_deals strips them) — keep the stored values on update.
const HIDDEN_CUSTOM_KEYS = ['net_invoice_amount', 'commission_amount']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401)

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: me, error: meErr } = await userClient.auth.getUser()
    if (meErr || !me?.user) return json({ error: 'Invalid session' }, 401)

    const admin = createClient(url, serviceKey)
    const { data: prof } = await admin.from('profiles').select('role, full_name').eq('id', me.user.id).single()
    if (!prof || prof.role !== 'recruiter') return json({ error: 'Recruiter role required' }, 403)

    const body = await req.json()
    const mode: 'insert' | 'update' = body.mode === 'update' ? 'update' : 'insert'
    const id: string | null = body.id ?? null
    const payload: Record<string, unknown> = { ...(body.payload ?? {}) }
    if (mode === 'update' && !id) return json({ error: 'id required' }, 400)

    // Own-lead check up front (the RPC re-checks under her identity).
    let existing: Record<string, unknown> | null = null
    if (id) {
      const { data } = await admin
        .from('transactions')
        .select('service_lead, custom_fields, supplier_percent, approved_at, needs_approval')
        .eq('id', id)
        .maybeSingle()
      existing = data
      if (!existing || existing.service_lead !== prof.full_name) return json({ error: 'not authorized to save this transaction' }, 403)
    }
    if (payload.service_lead !== prof.full_name) return json({ error: 'not authorized to save this transaction' }, 403)

    // The recruiter never edits the supplier — never let her payload clear it.
    delete payload.supplier_id
    delete payload.supplier_percent

    // Preserve the hidden derived totals inside custom_fields when she didn't send them.
    const incomingCustom = { ...((payload.custom_fields as Record<string, unknown>) ?? {}) }
    const storedCustom = (existing?.custom_fields as Record<string, unknown> | null) ?? {}
    for (const k of HIDDEN_CUSTOM_KEYS) {
      if (incomingCustom[k] === undefined && storedCustom[k] !== undefined) incomingCustom[k] = storedCustom[k]
    }
    payload.custom_fields = incomingCustom

    // Billing context (accounting data — read here with the service role, never returned).
    let client: Record<string, unknown> | null = null
    if (payload.client_id) {
      const { data } = await admin
        .from('clients')
        .select('payment_split_json, advance_type, advance_amount')
        .eq('id', payload.client_id as string)
        .maybeSingle()
      client = data
    }
    let existingEvents: never[] = []
    if (id) {
      const { data } = await admin
        .from('billing_events')
        .select('*')
        .eq('transaction_id', id)
        .order('event_index', { ascending: true })
      existingEvents = (data ?? []) as never[]
    }

    const finalSalaryChanged = !!body.final_salary_changed
    const { events, shouldGenerateEvents } = buildDealEvents({
      editingId: id,
      kind: (payload.kind as 'service' | 'time_period') ?? 'service',
      serviceTypeName: String(payload.service_type ?? ''),
      entryDate: String(payload.entry_date ?? ''),
      workStartDate: (payload.work_start_date as string | null) || null,
      custom: incomingCustom,
      supplierPercent: (existing?.supplier_percent as number | null) ?? null,
      clientName: String(payload.client_name ?? ''),
      periodStart: (payload.period_start as string | null) ?? null,
      periodEnd: (payload.period_end as string | null) ?? null,
      hoursTotal: (payload.hours_total as number | null) ?? null,
      hourlyRate: null,
      paymentSplit: (client?.payment_split_json as never[]) ?? [],
      advanceType: ((client?.advance_type as 'fixed' | 'percent' | null) ?? '') as 'fixed' | 'percent' | '',
      advanceAmount: client?.advance_amount != null ? String(client.advance_amount) : '',
      existingEvents,
      shouldReconcile: finalSalaryChanged && existingEvents.length > 0,
    })

    // Same rule as the dialog: a recruiter's brand-new deal awaits approval (no flip); an
    // already-approved deal may flip past-dated pending events.
    const txnApproved = !!existing?.approved_at

    const { data: txnId, error } = await userClient.rpc('save_transaction_with_events', {
      p_mode: mode,
      p_id: id,
      p_payload: payload,
      p_events: events,
      p_flip_to_bill: shouldGenerateEvents && txnApproved,
      p_work_end_date: body.work_end_date ?? null,
    })
    if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 400)
    return json({ id: txnId })
  } catch (e) {
    console.error('recruiter-save-deal error:', e)
    return json({ error: 'Internal error' }, 500)
  }
})
