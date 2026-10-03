import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Trophy, ChevronLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  fetchBonusEvents,
  buildBonusLedger,
  currentMonthKey,
  normalizeLead,
  actualForecastProgress,
  type BonusEvent,
  type LedgerMonth,
} from '@/lib/bonus'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const EMPTY_MONTH: LedgerMonth = {
  actualRevenue: 0, expectedRevenue: 0, forecastRevenue: 0, actualBonus: 0, forecastBonus: 0,
  isPast: false, isCurrent: true, events: [],
}

// Batch 5 Phase B1: small bonus card for the admin dashboard.
// Repair 16: now sourced from the shared bonus engine (actual vs. forecast).
export default function BonusWidget() {
  const navigate = useNavigate()
  const todayKey = currentMonthKey()
  const [yearStr, monthStr] = todayKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles-with-bonus'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').not('bonus_model', 'is', null)
      if (error) throw error
      return data as Profile[]
    },
  })

  // Unfiltered — same cache entry the Bonuses page uses, grouped per employee below.
  const { data: events = [] } = useQuery<BonusEvent[]>({
    queryKey: ['bonus-events'],
    queryFn: () => fetchBonusEvents(supabase),
  })

  const rows = useMemo(() => {
    return profiles
      .map((p) => {
        const mine = events.filter((e) => normalizeLead(e.service_lead) === normalizeLead(p.full_name))
        const tiers = p.bonus_model?.tiers ?? []
        const ledger = buildBonusLedger(mine, tiers, todayKey)
        const m = ledger.get(todayKey) ?? EMPTY_MONTH
        const progress = actualForecastProgress(m.actualRevenue, m.forecastRevenue, tiers)
        return { profile: p, month: m, progress }
      })
      .sort((a, b) => b.month.actualBonus - a.month.actualBonus)
  }, [profiles, events, todayKey])

  const totalActual = rows.reduce((s, r) => s + r.month.actualBonus, 0)
  const totalForecast = rows.reduce((s, r) => s + r.month.forecastBonus, 0)

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate('/bonuses')}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-purple-600" />
            בונוסים — {HEBREW_MONTHS[month - 1]} {year}
          </span>
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עדיין לא הוגדרו מודלי בונוס. עבור ל-/team כדי להגדיר.
          </p>
        ) : (
          <>
            {rows.map(({ profile, month: m, progress }) => {
              const initial = (profile.full_name || '?').charAt(0)
              const tierMin = progress.currentTier?.min ?? 0
              const nextMin = progress.nextTier?.min ?? Math.max(tierMin, m.actualRevenue)
              return (
                <div key={profile.id} className="flex items-center gap-3 text-sm">
                  <div className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{profile.full_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {ILS.format(m.actualRevenue)} / {ILS.format(nextMin)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded mt-1 overflow-hidden relative">
                      <div
                        className="h-full bg-purple-200 transition-all"
                        style={{ width: `${progress.forecastPct}%` }}
                      />
                      <div
                        className="h-full bg-purple-600 transition-all absolute inset-y-0 right-0"
                        style={{ width: `${progress.actualPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="text-purple-700 font-semibold">{ILS.format(m.actualBonus)}</div>
                    <div className="text-[11px] text-purple-300">תחזית {ILS.format(m.forecastBonus)}</div>
                  </div>
                </div>
              )
            })}
            <div className="border-t pt-2 mt-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">סה&quot;כ בונוסים</span>
              <div className="text-left">
                <span className="font-semibold text-purple-900">{ILS.format(totalActual)}</span>
                <span className="text-[11px] text-purple-300 mr-2">תחזית {ILS.format(totalForecast)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
