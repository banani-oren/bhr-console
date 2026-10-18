import type { BonusTier } from './types'
import {
  buildBonusDeals,
  buildLedgerFromDeals,
  type BonusDeal,
  type BonusEvent,
} from './bonus'
import { fromAgorot, toAgorot } from './finance'
import { workdaysLeftInMonth } from './ilCalendar'
import { barGeometry, type BarGeometry } from './bonusBar'

// Repair 31 — the recruiter's bonus presentation payload. Pure function over the SAME
// engine as every other bonus surface (bonus.ts: buildBonusDeals → buildLedgerFromDeals,
// Repair 27: a deal counts only when fully collected, at full value, in the month of its
// last payment). It adds NO second bonus rule — only counts and bonus amounts for display.
//
// Runs inside the my-bonus-overview Edge Function (service role, scoped to the caller's
// own service_lead). The payload contains bonus amounts and deal COUNTS only — never a
// deal amount, a revenue figure or a tier threshold in shekels.

export type BonusOverviewMonth = {
  month: string // 'YYYY-MM'
  locked_bonus: number
  expected_bonus: number
  locked_deals_count: number
  expected_deals_count: number
}

/** A deal expected to complete this month (identification only — no amounts). */
export type ExpectedDealRef = {
  deal_id: string
  client_name: string | null
  position_name: string | null
  candidate_name: string | null
}

// Repair 32 (B.1). Statuses: locked = מובטח (Repair 27 actual), expected = צפוי (this month, full value).
// current_tier follows ACTUAL revenue (Repair 16: never the forecast). next_tier is the first tier ABOVE
// the month's forecast revenue, so "expected deals to complete + about N more" is one coherent target.
/** Repair 33: one card of the forward-looking panel (current month + the next three). */
export type UpcomingMonth = {
  month: string // 'YYYY-MM'
  counted_bonus: number // already counted in that month (0 for future months)
  expected_bonus: number // forecast from deals not yet fully paid (Repair 27 forecast − counted)
  expected_deals: ExpectedDealRef[]
  next_tier_bonus: number | null // first tier above the month's forecast; null = top tier / no model
  deals_to_next_tier_estimate: number | null // remaining gap ÷ her 12-month average deal value, min 1; null = no history / top tier
  avg_deal_bonus: number | null // her average bonus per completed deal, last 12 months (display of the estimate); null = no history
  top_tier_reached: boolean
  bar: BarGeometry
}

export type BonusOverview = {
  month: string // 'YYYY-MM'
  upcoming: UpcomingMonth[] // exactly 4: current month, +1, +2, +3
  current_month_closed: true // informational — the UI never asks her to act on the current month
  months: BonusOverviewMonth[] // chart: 6 back .. 2 forward
  locked: { bonus: number; deals_count: number }
  expected: { bonus: number; deals_count: number; deals: ExpectedDealRef[] } // bonus = the extra on top of locked
  current_tier: { bonus: number } | null
  next_tier: { bonus: number; deals_to_tier_estimate: number | null } | null // null = top tier / no model
  top_tier: 'locked' | 'expected' | null // top tier reached by locked deals / only with the expected ones
  has_model: boolean
  workdays_left: number // workdays after today in this month (Israeli calendar)
  pending_unknown_count: number
}

const shiftMonth = (key: string, delta: number): string => {
  const [y, m] = key.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export function buildBonusOverview(
  events: BonusEvent[],
  tiers: BonusTier[],
  todayIso: string,
): BonusOverview {
  const todayKey = todayIso.slice(0, 7)
  const deals: BonusDeal[] = buildBonusDeals(events, todayKey)
  const ledger = buildLedgerFromDeals(deals, tiers, todayKey)

  const countDeals = (monthKey: string, kind: 'actual' | 'expected') =>
    deals.filter((d) => d.completionMonthKey === monthKey && d.kind === kind).length

  const months: BonusOverviewMonth[] = []
  for (let i = -6; i <= 2; i++) {
    const key = shiftMonth(todayKey, i)
    const lm = ledger.get(key)
    const locked = lm?.actualBonus ?? 0
    const forecast = lm?.forecastBonus ?? 0
    months.push({
      month: key,
      locked_bonus: locked,
      expected_bonus: Math.max(0, forecast - locked),
      locked_deals_count: countDeals(key, 'actual'),
      expected_deals_count: key < todayKey ? 0 : countDeals(key, 'expected'),
    })
  }

  const cur = ledger.get(todayKey)
  const actualRevenue = cur?.actualRevenue ?? 0
  const forecastRevenue = cur?.forecastRevenue ?? 0
  const lockedBonus = cur?.actualBonus ?? 0
  const forecastBonus = cur?.forecastBonus ?? 0
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  const top = sorted.length ? sorted[sorted.length - 1] : null

  // ── Repair 33: upcoming months ──
  const histFrom = shiftMonth(todayKey, -11)
  const history = deals.filter(
    (d) => d.kind === 'actual' && d.completionMonthKey && d.completionMonthKey >= histFrom && d.completionMonthKey <= todayKey,
  )
  const avgValue = history.length > 0 ? fromAgorot(Math.round(history.reduce((s, d) => s + toAgorot(d.dealIncome), 0) / history.length)) : null
  let histBonus = 0
  for (let i = -11; i <= 0; i++) histBonus += ledger.get(shiftMonth(todayKey, i))?.actualBonus ?? 0
  const avgDealBonus = history.length > 0 && histBonus > 0 ? Math.round(histBonus / history.length) : null
  const upcoming: UpcomingMonth[] = []
  for (let i = 0; i <= 3; i++) {
    const key = shiftMonth(todayKey, i)
    const lm = ledger.get(key)
    const counted = lm?.actualBonus ?? 0
    const forecastRev = lm?.forecastRevenue ?? 0
    const expectedBonus = Math.max(0, (lm?.forecastBonus ?? 0) - counted)
    const nextT = sorted.find((t) => t.min > forecastRev) ?? null
    const est = nextT && avgValue && avgValue > 0 ? Math.max(1, Math.ceil((nextT.min - forecastRev) / avgValue)) : null
    const mDeals = deals.filter((d) => d.kind === 'expected' && d.completionMonthKey === key)
    upcoming.push({
      month: key,
      counted_bonus: counted,
      expected_bonus: expectedBonus,
      expected_deals: mDeals.map((d) => ({ deal_id: d.transaction_id, client_name: d.client_name, position_name: d.position_name, candidate_name: d.candidate_name })),
      next_tier_bonus: nextT ? nextT.bonus : null,
      deals_to_next_tier_estimate: est,
      avg_deal_bonus: avgDealBonus,
      top_tier_reached: !!top && !nextT && forecastRev >= top.min,
      bar: barGeometry({ counted, expected: expectedBonus, next: nextT ? nextT.bonus : null, estimateDeals: est, avgDealBonus }),
    })
  }

  const expectedDeals = deals.filter((d) => d.kind === 'expected' && d.completionMonthKey === todayKey)

  // next tier above the FORECAST revenue; extra-deals estimate = remaining shekel gap ÷ her average
  // completed-deal value over the last 12 months (rounded up, min 1); null with no history.
  const nextTier = sorted.find((t) => t.min > forecastRevenue) ?? null
  let estimate: number | null = null
  if (nextTier) {
    const from = shiftMonth(todayKey, -11)
    const history = deals.filter(
      (d) => d.kind === 'actual' && d.completionMonthKey && d.completionMonthKey >= from && d.completionMonthKey <= todayKey,
    )
    if (history.length > 0) {
      const totalAg = history.reduce((s, d) => s + toAgorot(d.dealIncome), 0)
      const avg = fromAgorot(Math.round(totalAg / history.length))
      estimate = avg > 0 ? Math.max(1, Math.ceil((nextTier.min - forecastRevenue) / avg)) : null
    }
  }

  let topTier: BonusOverview['top_tier'] = null
  if (top && !nextTier && forecastRevenue >= top.min) topTier = actualRevenue >= top.min ? 'locked' : 'expected'

  return {
    month: todayKey,
    upcoming,
    current_month_closed: true,
    months,
    locked: { bonus: lockedBonus, deals_count: countDeals(todayKey, 'actual') },
    expected: {
      bonus: Math.max(0, forecastBonus - lockedBonus),
      deals_count: expectedDeals.length,
      deals: expectedDeals.map((d) => ({
        deal_id: d.transaction_id,
        client_name: d.client_name,
        position_name: d.position_name,
        candidate_name: d.candidate_name,
      })),
    },
    current_tier: lockedBonus > 0 ? { bonus: lockedBonus } : null,
    next_tier: nextTier ? { bonus: nextTier.bonus, deals_to_tier_estimate: estimate } : null,
    top_tier: topTier,
    has_model: sorted.length > 0,
    workdays_left: workdaysLeftInMonth(todayIso),
    pending_unknown_count: deals.filter((d) => d.kind === 'unknown').length,
  }
}
