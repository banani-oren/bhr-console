import { supabase } from '@/lib/supabase'
import type { ClientWithAgreement, PaymentSplit } from '@/lib/types'

export type ClientFormData = {
  name: string
  company_id?: string
  group_name?: string
  address?: string
  phone?: string
  email?: string
  contact_name?: string
  status: string
  notes?: string
  // Contract terms (kept)
  commission_percent?: number | null
  warranty_days?: number | null
  payment_terms?: string
  // New structured fields
  payment_split_json?: PaymentSplit[]
  advance_type?: 'fixed' | 'percent' | null
  advance_amount?: number | null
  // Hours billing
  hourly_rate?: number | null
  time_log_enabled?: boolean
}

export async function getClients(filters?: {
  search?: string
  status?: string
  group?: string
}): Promise<ClientWithAgreement[]> {
  let query = supabase
    .from('clients')
    .select('*, agreements(*)')
    .order('name', { ascending: true })

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters?.group && filters.group !== 'all') {
    query = query.eq('group_name', filters.group)
  }
  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ClientWithAgreement[]
}

export async function getClientById(id: string): Promise<ClientWithAgreement | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*, agreements(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as ClientWithAgreement
}

export async function upsertClient(
  formData: ClientFormData,
  existingClientId?: string
): Promise<{ clientId: string }> {
  const clientPayload = {
    name: formData.name,
    company_id: formData.company_id || null,
    group_name: formData.group_name || null,
    address: formData.address || null,
    phone: formData.phone || null,
    email: formData.email || null,
    contact_name: formData.contact_name || null,
    status: formData.status || 'פעיל',
    notes: formData.notes || null,
    commission_percent: formData.commission_percent ?? null,
    warranty_days: formData.warranty_days ?? null,
    payment_terms: formData.payment_terms || null,
    payment_split_json: formData.payment_split_json ?? [],
    advance_type: formData.advance_type || null,
    advance_amount: formData.advance_amount ?? null,
    hourly_rate: formData.hourly_rate ?? null,
    time_log_enabled: formData.time_log_enabled ?? false,
  }

  let clientId: string

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
  try {
    if (existingClientId) {
      const { error } = await supabase
        .from('clients')
        .update(clientPayload)
        .eq('id', existingClientId)
        .abortSignal(controller.signal)
      if (error) throw error
      clientId = existingClientId
    } else {
      const { data, error } = await supabase
        .from('clients')
        .insert(clientPayload)
        .select('id')
        .abortSignal(controller.signal)
        .single()
      if (error) throw error
      clientId = data.id
    }
  } finally {
    clearTimeout(timer)
  }

  return { clientId }
}

export async function deleteClient(id: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
  try {
    const { error } = await supabase.from('clients').delete().eq('id', id).abortSignal(controller.signal)
    if (error) throw error
  } finally {
    clearTimeout(timer)
  }
}
