import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Trophy, ChevronLeft } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import type { Profile, Transaction } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { computeMonthlyBonusRows, transactionMonth, calculateBonus } from '@/lib/bonus'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const ROLE_LABELS_HE: Record<string, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

export default function Bonuses() {
  const navigate = useNavigate()
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles-with-bonus'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .not('bonus_model', 'is', null)
        .order('full_name', { ascending: true })
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

  const monthRows = useMemo(
    () => computeMonthlyBonusRows(profiles, txns, month, year),
    [profiles, txns, month, year],
  )

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">
          בונוסים — {HEBREW_MONTHS[month - 1]} {year}
        </h1>
      </div>

      {profiles.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          עדיין לא הוגדרו מודלי בונוס. עבור ל-/team כדי להגדיר.
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {monthRows.map((row) => {
            const tiers = row.profile.bonus_model?.tiers ?? []
            // YTD: sum of monthly bonuses for completed months in this calendar year.
            const ytdBonus = (() => {
              let total = 0
              for (let m = 1; m < month; m++) {
                const monthTxns = txns.filter((t) => {
                  const tm = transactionMonth(t)
                  if (!tm || tm.year !== year || tm.month !== m) return false
                  const f = row.profile.bonus_model?.filter
                  if (!f) return false
                  const cell = (t as unknown as Record<string, unknown>)[f.field]
                  return cell != null && String(cell).toLowerCase().includes((f.contains ?? '').toLowerCase())
                })
                const rev = monthTxns.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
                total += calculateBonus(rev, tiers)
              }
              return total
            })()

            const trendData = (() => {
              const arr: { month: string; bonus: number }[] = []
              for (let m = 1; m <= 12; m++) {
                const monthTxns = txns.filter((t) => {
                  const tm = transactionMonth(t)
                  if (!tm || tm.year !== year || tm.month !== m) return false
                  const f = row.profile.bonus_model?.filter
                  if (!f) return false
                  const cell = (t as unknown as Record<string, unknown>)[f.field]
                  return cell != null && String(cell).toLowerCase().includes((f.contains ?? '').toLowerCase())
                })
                const rev = monthTxns.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
                arr.push({ month: HEBREW_MONTHS[m - 1].slice(0, 3), bonus: calculateBonus(rev, tiers) })
              }
              return arr
            })()

            return (
              <Card key={row.profile.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-semibold">
                        {(row.profile.full_name || '?').charAt(0)}
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold leading-tight">
                          {row.profile.full_name}
                        </CardTitle>
                        <Badge variant="secondary" className="mt-1 text-[11px] font-normal">
                          {ROLE_LABELS_HE[row.profile.role] ?? row.profile.role}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/team')}
                      className="text-purple-700 border-purple-300"
                    >
                      ערוך מודל <ChevronLeft className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <Stat label="הכנסה החודש" value={ILS.format(row.monthRevenue)} />
                    <Stat
                      label="מדרגה נוכחית"
                      value={row.breakdown.currentTier ? ILS.format(row.breakdown.currentTier.min) : '—'}
                    />
                    <Stat label="בונוס" value={ILS.format(row.breakdown.bonus)} highlight />
                  </div>
                  {row.breakdown.nextTier ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{ILS.format(row.breakdown.currentTier?.min ?? 0)}</span>
                        <span>{ILS.format(row.breakdown.nextTier.min)}</span>
                      </div>
                      <div className="h-2 bg-muted rounded overflow-hidden">
                        <div
                          className="h-full bg-purple-600"
                          style={{ width: `${row.breakdown.progressPct}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        עוד {ILS.format(row.breakdown.amountToNext)} למדרגת {ILS.format(row.breakdown.nextTier.bonus)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">הגעת למדרגה המקסימלית!</p>
                  )}
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right text-xs">מינימום (₪)</TableHead>
                          <TableHead className="text-right text-xs">בונוס (₪)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tiers
                          .slice()
                          .sort((a, b) => a.min - b.min)
                          .map((t, i) => (
                            <TableRow key={i} className={row.breakdown.currentTier?.min === t.min ? 'bg-purple-50' : ''}>
                              <TableCell className="text-xs">{ILS.format(t.min)}</TableCell>
                              <TableCell className="text-xs font-medium">{ILS.format(t.bonus)}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      בונוסים מצטברים השנה: <span className="font-semibold text-foreground">{ILS.format(ytdBonus)}</span>
                    </p>
                    <div className="h-32">
                      <ResponsiveContainer>
                        <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} width={40} />
                          <Tooltip formatter={(v) => ILS.format(Number(v) || 0)} />
                          <Bar dataKey="bonus" fill="#7c3aed" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm ${highlight ? 'text-purple-700 font-semibold' : 'font-medium'}`}>{value}</p>
    </div>
  )
}
