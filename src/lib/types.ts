export type Profile = {
  id: string
  full_name: string
  role: 'admin' | 'employee'
  bonus_model: BonusModel | null
  hours_category_enabled: boolean
}

export type Client = {
  id: string
  name: string
  contact_name: string
  phone: string
  email: string
  status: string
  created_at: string
}

export type Agreement = {
  id: string
  client_id: string
  client_name: string
  agreement_type: string
  commission_rate: number
  monthly_fee: number
  start_date: string
  end_date: string | null
  notes: string | null
  created_at: string
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

export type TeamMember = {
  id: string
  name: string
  role: string
  email: string
  status: string
  bonus_model: BonusModel | null
  hours_category_enabled: boolean
  portal_token: string | null
  created_at: string
}

export type HoursLog = {
  id: string
  team_member_id: string
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
