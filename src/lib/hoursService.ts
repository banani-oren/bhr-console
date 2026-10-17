// Single source of truth for the hours-billing service (Repair 25).
//
// Business rule (Oren, 2026-10-17): hourly billing happens ONLY for the service
// "שירות משאבי אנוש" — every hours deal is שירות משאבי אנוש and every שירות
// משאבי אנוש deal is an hours (kind='time_period') deal. The old text
// 'שעות עבודה' is retired as a SERVICE-TYPE name.
//
// An hours deal's תאריך סגירה is the last day of the month the hours cover
// (period_end), and its סכום חשבונית is hours_total × hourly_rate_used (or the
// sum of its non-cancelled billing events).
import { supabase } from '@/lib/supabase'
import { endOfMonth } from '@/lib/billingEvents'

export const HOURS_SERVICE_NAME = 'שירות משאבי אנוש'

export const isHoursServiceName = (name: string | null | undefined) => name === HOURS_SERVICE_NAME

/** Pick the hours service-type id out of an already-loaded service_types list. */
export function findHoursServiceTypeId(serviceTypes: { id: string; name: string }[]): string | null {
  return serviceTypes.find((s) => s.name === HOURS_SERVICE_NAME)?.id ?? null
}

/** Resolve the hours service-type id from the DB (for paths with no loaded list). */
export async function resolveHoursServiceTypeId(signal?: AbortSignal): Promise<string> {
  let q = supabase.from('service_types').select('id').eq('name', HOURS_SERVICE_NAME).limit(1)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  const id = (data?.[0] as { id: string } | undefined)?.id
  if (!id) throw new Error(`סוג השירות "${HOURS_SERVICE_NAME}" לא הוגדר`)
  return id
}

/**
 * close_date / closing_month / closing_year of an hours deal: last day of the
 * month of period_end (falling back to period_start). Same date as the billing
 * event's billing_date (Repair 15) — one shared helper (endOfMonth).
 */
export function hoursCloseFields(periodEnd: string | null | undefined, periodStart?: string | null) {
  const basis = periodEnd || periodStart
  if (!basis) return { close_date: null, closing_month: null, closing_year: null }
  const close = endOfMonth(basis)
  return { close_date: close, closing_month: Number(close.slice(5, 7)), closing_year: Number(close.slice(0, 4)) }
}
