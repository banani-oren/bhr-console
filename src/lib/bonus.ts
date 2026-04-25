import type { BonusModel, BonusTier, Profile, Transaction } from './types'

// ---------------------------------------------------------------------------
// Tier math
// ---------------------------------------------------------------------------

export function calculateBonus(revenue: number, tiers: BonusTier[]): number {
  if (!tiers || tiers.length === 0) return 0
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  let bonus = 0
  for (const t of sorted) {
    if (revenue >= t.min) bonus = t.bonus
    else break
  }
  return bonus
}

export type BonusBreakdown = {
  revenue: number
  currentTier: BonusTier | null
  nextTier: BonusTier | null
  bonus: number
  progressPct: number
  amountToNext: number
  tierIndex: number
}

export function bonusBreakdown(revenue: number, tiers: BonusTier[]): BonusBreakdown {
  if (!tiers || tiers.length === 0) {
    return { revenue, currentTier: null, nextTier: null, bonus: 0, progressPct: 0, amountToNext: 0, tierIndex: -1 }
  }
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  let tierIndex = -1
  for (let i = 0; i < sorted.length; i++) {
    if (revenue >= sorted[i].min) tierIndex = i
    else break
  }
  const currentTier = tierIndex >= 0 ? sorted[tierIndex] : null
  const nextTier = tierIndex + 1 < sorted.length ? sorted[tierIndex + 1] : null
  const bonus = currentTier ? currentTier.bonus : 0
  let progressPct = 0
  let amountToNext = 0
  if (nextTier) {
    const lowerBound = currentTier ? currentTier.min : 0
    const span = Math.max(1, nextTier.min - lowerBound)
    progressPct = Math.min(100, Math.max(0, ((revenue - lowerBound) / span) * 100))
    amountToNext = Math.max(0, nextTier.min - revenue)
  } else if (currentTier) {
    progressPct = 100
  }
  return { revenue, currentTier, nextTier, bonus, progressPct, amountToNext, tierIndex }
}

// ---------------------------------------------------------------------------
// Transaction → employee attribution
//
// Each transaction carries a `service_lead` field (the employee's name).
// The bonus for a profile is calculated from transactions where
// service_lead matches profile.full_name (case-insensitive).
// ---------------------------------------------------------------------------

export function filterByEmployee(txns: Transaction[], fullName: string): Transaction[] {
  const needle = (fullName ?? '').trim().toLowerCase()
  if (!needle) return []
  return txns.filter((t) => (t.service_lead ?? '').trim().toLowerCase() === needle)
}

// Kept for backward compatibility — delegates to filterByEmployee when a name
// is supplied; falls back to the legacy field/contains filter otherwise.
export function filterRevenueTransactions(
  txns: Transaction[],
  model: BonusModel,
  employeeName?: string,
): Transaction[] {
  if (employeeName) return filterByEmployee(txns, employeeName)
  const f = model.filter
  if (!f || !f.field) return txns
  const needle = (f.contains ?? '').trim().toLowerCase()
  if (!needle) return txns
  return txns.filter((t) => {
    const cell = (t as unknown as Record<string, unknown>)[f.field]
    if (cell == null) return false
    return String(cell).toLowerCase().includes(needle)
  })
}

// ---------------------------------------------------------------------------
// Transaction → month attribution
//
// PRIMARY:  billing_month / billing_year  (when revenue is actually collected)
// FALLBACK: closing_month / closing_year  (when the deal was signed)
// LAST:     entry_date
// ---------------------------------------------------------------------------

export function transactionMonth(t: Transaction): { month: number; year: number } | null {
  // Billing date = when money lands = the correct month for bonus accumulation.
  if (t.billing_year && t.billing_month) {
    return { month: t.billing_month, year: t.billing_year }
  }
  // Fall back to deal-close date if billing not set.
  if (t.closing_year && t.closing_month) {
    return { month: t.closing_month, year: t.closing_year }
  }
  if (t.entry_date) {
    const d = new Date(t.entry_date)
    if (!Number.isNaN(d.getTime())) return { month: d.getMonth() + 1, year: d.getFullYear() }
  }
  return null
}

// ---------------------------------------------------------------------------
// Monthly rollup
// ---------------------------------------------------------------------------

export type EmployeeBonusRow = {
  profile: Profile
  breakdown: BonusBreakdown
  monthRevenue: number
}

export function computeMonthlyBonusRows(
  profiles: Profile[],
  txns: Transaction[],
  month: number,
  year: number,
): EmployeeBonusRow[] {
  const out: EmployeeBonusRow[] = []
  for (const p of profiles) {
    if (!p.bonus_model) continue
    const filtered = filterByEmployee(txns, p.full_name ?? '').filter((t) => {
      const tm = transactionMonth(t)
      return tm && tm.month === month && tm.year === year
    })
    const monthRevenue = filtered.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
    const breakdown = bonusBreakdown(monthRevenue, p.bonus_model.tiers)
    out.push({ profile: p, breakdown, monthRevenue })
  }
  return out.sort((a, b) => b.breakdown.bonus - a.breakdown.bonus)
}
