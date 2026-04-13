import { supabase } from '@/lib/supabase'
import type { ClientWithAgreement } from '@/lib/types'

export type ClientFormData = {
  // Client fields
  name: string
  tax_id?: string
  group_name?: string
  address?: string
  phone?: string
  email?: string
  contact_name?: string
  status: string
  notes?: string
  // Agreement fields
  agreement_type?: string
  commission_pct?: number | null
  salary_base?: number | null
  payment_split?: string
  warranty_days?: number | null
  payment_terms?: string
  advance?: string
  exclusivity?: boolean
  agreement_contact_name?: string
  agreement_contact_email?: string
  agreement_contact_phone?: string
  contract_file?: string
  agreement_status?: string
  agreement_notes?: string
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
    tax_id: formData.tax_id || null,
    group_name: formData.group_name || null,
    address: formData.address || null,
    phone: formData.phone || null,
    email: formData.email || null,
    contact_name: formData.contact_name || null,
    status: formData.status || 'פעיל',
    notes: formData.notes || null,
  }

  let clientId: string

  if (existingClientId) {
    const { error } = await supabase
      .from('clients')
      .update(clientPayload)
      .eq('id', existingClientId)
    if (error) throw error
    clientId = existingClientId
  } else {
    const { data, error } = await supabase
      .from('clients')
      .insert(clientPayload)
      .select('id')
      .single()
    if (error) throw error
    clientId = data.id
  }

  // Upsert agreement (1:1 with client)
  const agreementPayload = {
    client_id: clientId,
    agreement_type: formData.agreement_type || null,
    commission_pct: formData.commission_pct ?? null,
    salary_base: formData.salary_base ?? null,
    payment_split: formData.payment_split || null,
    warranty_days: formData.warranty_days ?? null,
    payment_terms: formData.payment_terms || null,
    advance: formData.advance || null,
    exclusivity: formData.exclusivity ?? false,
    contact_name: formData.agreement_contact_name || null,
    contact_email: formData.agreement_contact_email || null,
    contact_phone: formData.agreement_contact_phone || null,
    contract_file: formData.contract_file || null,
    status: formData.agreement_status || 'active',
    notes: formData.agreement_notes || null,
  }

  const { error: agErr } = await supabase
    .from('agreements')
    .upsert(agreementPayload, { onConflict: 'client_id' })
  if (agErr) throw agErr

  return { clientId }
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}
