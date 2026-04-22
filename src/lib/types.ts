export type UserRole = 'admin' | 'administration' | 'recruiter'

export type Profile = {
  id: string
  full_name: string
  email: string
  role: UserRole
  bonus_model: BonusModel | null
  hours_category_enabled: boolean
  password_set: boolean
  phone: string | null
  status: string
  created_at: string
}

export type Client = {
  id: string
  name: string
  company_id: string | null
  tax_id: string | null
  group_name: string | null
  address: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  status: string
  notes: string | null
  agreement_type: string | null
  commission_percent: number | null
  salary_basis: string | null
  warranty_days: number | null
  payment_terms: string | null
  payment_split: string | null
  advance: string | null
  exclusivity: boolean
  agreement_file: string | null
  agreement_storage_path: string | null
  hourly_rate: number | null
  time_log_enabled: boolean
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

export type TransactionKind = 'service' | 'time_period'

export type Transaction = {
  id: string
  kind: TransactionKind
  client_name: string
  position_name: string
  candidate_name: string
  service_type: string
  service_type_id: string | null
  custom_fields: Record<string, unknown>
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
  invoice_number_transaction: string | null
  invoice_number_receipt: string | null
  work_start_date: string | null
  warranty_end_date: string | null
  invoice_sent_date: string | null
  payment_due_date: string | null
  period_start: string | null
  period_end: string | null
  hours_total: number | null
  hourly_rate_used: number | null
  time_sheet_pdf_path: string | null
  notes: string | null
  created_at: string
}

export type HoursLog = {
  id: string
  team_member_id: string | null
  profile_id: string | null
  client_name: string
  client_id: string | null
  visit_date: string
  hours: number
  description: string | null
  hours_category: string | null
  start_time: string | null
  end_time: string | null
  billed_transaction_id: string | null
  month: number
  year: number
  created_at: string
}

export type BillingReport = {
  id: string
  client_id: string
  period_start: string
  period_end: string
  issued_at: string
  issued_by: string | null
  transaction_ids: string[]
  total_amount: number
  pdf_storage_path: string | null
  notes: string | null
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
