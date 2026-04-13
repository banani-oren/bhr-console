export type Profile = {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'employee'
  bonus_model: BonusModel | null
  hours_category_enabled: boolean
  portal_token: string | null
  phone: string | null
  status: string
  created_at: string
}

export type Client = {
  id: string
  name: string
  tax_id: string | null
  group_name: string | null
  address: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  status: string
  notes: string | null
  created_at: string
}

export type Agreement = {
  id: string
  client_id: string
  agreement_type: string | null
  commission_pct: number | null
  salary_base: number | null
  payment_split: string | null
  warranty_days: number | null
  payment_terms: string | null
  advance: string | null
  exclusivity: boolean
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  contract_file: string | null
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type ClientWithAgreement = Client & {
  agreements: Agreement[]
}

export type Transaction = {
  id: string
  client_name: string
  position_name: string
  candidate_name: string
  service_type: string
  salary: number
  commission_percent: number
  net_invoice_amount: number
  commission_amount: number
  service_lead: string
  entry_date: string
  billing_month: number
  billing_year: number
  close_date: string | null
  closing_month: number | null
  closing_year: number | null
  payment_date: string | null
  payment_status: string
  is_billable: boolean
  invoice_number: string | null
  notes: string | null
  created_at: string
}

export type HoursLog = {
  id: string
  team_member_id: string | null
  profile_id: string | null
  client_name: string
  visit_date: string
  hours: number
  description: string | null
  hours_category: string | null
  month: number
  year: number
  created_at: string
}

export type BonusTier = {
  min: number
  bonus: number
}

export type BonusModel = {
  type: string
  filter: {
    field: string
    contains: string
  }
  tiers: BonusTier[]
}
