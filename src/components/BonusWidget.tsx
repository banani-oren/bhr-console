import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Trophy, ChevronLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Profile, Transaction } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { computeMonthlyBonusRows } from '@/lib/bonus'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

// Batch 5 Phase B1: small bonus card for the admin dashboard.
export default function BonusWidget() {
  const navigate = useNavigate()
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles-with-bonus'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').not('bonus_model', 'is', null)
      if (error) throw error
      return data as Profile[]
    },
  })
  const { data: txns = [] } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions').select('*')
      if (error) throw error
      return data as Transaction[]
    },
  })

  const rows = useMemo(
    () => computeMonthlyBonusRows(profiles, txns, month, year),
    [profiles, txns, month, year],
  )
  const totalBonus = rows.reduce((s, r) => s + r.breakdown.bonus, 0)

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
            {rows.map((r) => {
              const initial = (r.profile.full_name || '?').charAt(0)
              const tierMin = r.breakdown.currentTier?.min ?? 0
              const nextMin = r.breakdown.nextTier?.min ?? Math.max(tierMin, r.monthRevenue)
              return (
                <div key={r.profile.id} className="flex items-center gap-3 text-sm">
                  <div className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{r.profile.full_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {ILS.format(r.monthRevenue)} / {ILS.format(nextMin)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded mt-1 overflow-hidden">
                      <div
                        className="h-full bg-purple-600 transition-all"
                        style={{ width: `${r.breakdown.progressPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-purple-700 font-semibold shrink-0">
                    {ILS.format(r.breakdown.bonus)}
                  </div>
                </div>
              )
            })}
            <div className="border-t pt-2 mt-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">סה"כ בונוסים צפויים</span>
              <span className="font-semibold text-purple-900">{ILS.format(totalBonus)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
