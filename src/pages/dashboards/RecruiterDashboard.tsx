import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Transaction, BonusModel } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { TrendingUp, Receipt, Clock } from 'lucide-react'

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })
const NUM = new Intl.NumberFormat('he-IL')

const HE_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
]

function txnMonth(t: Transaction): { year: number; month: number } | null {
  if (t.closing_year && t.closing_month) return { year: t.closing_year, month: t.closing_month }
  if (t.billing_year && t.billing_month) return { year: t.billing_year, month: t.billing_month }
  if (t.entry_date) {
    const d = new Date(t.entry_date)
    if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }
  return null
}

function calcBonusTier(rev: number, model: BonusModel | null | undefined) {
  if (!model?.tiers?.length) return null
  const sorted = [...model.tiers].sort((a, b) => a.min - b.min)
  const currentTier = [...sorted].reverse().find((t) => rev >= t.min) ?? sorted[0]
  const currentIdx = sorted.findIndex((t) => t.min === currentTier.min)
  const nextTier = currentIdx + 1 < sorted.length ? sorted[currentIdx + 1] : null
  return { sorted, currentTier, nextTier }
}

function buildRecent6Months(transactions: Transaction[]) {
  const now = new Date()
  const months: { label: string; year: number; month: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: `${HE_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    })
  }
  return months.map(({ label, year, month }) => {
    const revenue = transactions
      .filter((t) => {
        const m = txnMonth(t)
        return m && m.year === year && m.month === month
      })
      .reduce((sum, t) => sum + (t.net_invoice_amount ?? 0), 0)
    return { label, revenue }
  })
}

export default function RecruiterDashboard() {
  const { profile } = useAuth()

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Transaction[]
    },
  })

  const now = new Date()
  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1

  const monthTransactions = useMemo(
    () =>
      transactions.filter((t) => {
        const m = txnMonth(t)
        return m && m.year === curYear && m.month === curMonth
      }),
    [transactions, curYear, curMonth],
  )

  const monthRevenue = monthTransactions.reduce((s, t) => s + (t.net_invoice_amount ?? 0), 0)
  const monthClosedCount = monthTransactions.length
  const openCount = transactions.filter((t) => t.payment_status === 'ממתין').length

  const bonusInfo = calcBonusTier(monthRevenue, profile?.bonus_model)
  const monthlyRevenue = useMemo(() => buildRecent6Months(transactions), [transactions])
  const recent5 = transactions.slice(0, 5)

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]" dir="rtl">
        <p className="text-muted-foreground text-sm">טוען נתונים...</p>
      </div>
    )
  }

  const progressPct = bonusInfo?.nextTier
    ? Math.max(
        0,
        Math.min(
          100,
          ((monthRevenue - bonusInfo.currentTier.min) /
            (bonusInfo.nextTier.min - bonusInfo.currentTier.min)) *
            100,
        ),
      )
    : 100

  const remainingToNext = bonusInfo?.nextTier ? Math.max(0, bonusInfo.nextTier.min - monthRevenue) : 0

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">דשבורד</h1>

      {/* Hero bonus card */}
      <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
        <CardContent className="p-6 space-y-4">
          <div>
            <p className="text-sm text-purple-800/80">הבונוס שלך החודש</p>
            <p className="text-5xl font-bold text-purple-900 mt-1">
              {ILS.format(bonusInfo?.currentTier.bonus ?? 0)}
            </p>
          </div>
          {profile?.bonus_model ? (
            <div className="space-y-2">
              {bonusInfo?.nextTier ? (
                <>
                  <div className="h-3 w-full rounded-full bg-purple-200 overflow-hidden relative">
                    <div
                      className="h-full bg-purple-600 transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-purple-900/80">
                    <span>{ILS.format(bonusInfo.currentTier.min)}</span>
                    <span className="font-medium">
                      הכנסה החודש: {ILS.format(monthRevenue)}
                    </span>
                    <span>{ILS.format(bonusInfo.nextTier.min)}</span>
                  </div>
                  <p className="text-sm text-purple-900 font-medium">
                    עוד {ILS.format(remainingToNext)} למדרגת {ILS.format(bonusInfo.nextTier.bonus)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-purple-900 font-medium">
                  הגעת למדרגה המקסימלית! 🎉
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-purple-900/80">
              המנהל עדיין לא הגדיר מודל בונוס.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Secondary KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                הכנסה החודש
              </CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                <TrendingUp size={18} className="text-purple-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold leading-none">{ILS.format(monthRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                עסקאות שנסגרו החודש
              </CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                <Receipt size={18} className="text-purple-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold leading-none">{NUM.format(monthClosedCount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                עסקאות פתוחות
              </CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                <Clock size={18} className="text-purple-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold leading-none">{NUM.format(openCount)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">הכנסות — 6 חודשים אחרונים</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyRevenue} margin={{ top: 4, right: 4, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                formatter={(v: unknown) => ILS.format(Number(v ?? 0))}
                cursor={{ fill: 'rgba(124,58,237,0.08)' }}
              />
              <Bar dataKey="revenue" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">עסקאות אחרונות שלי</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right px-4">לקוח</TableHead>
                <TableHead className="text-right px-4">מועמד</TableHead>
                <TableHead className="text-right px-4">סוג שירות</TableHead>
                <TableHead className="text-right px-4">סכום נטו</TableHead>
                <TableHead className="text-right px-4">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent5.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    אין עסקאות להצגה
                  </TableCell>
                </TableRow>
              ) : (
                recent5.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="px-4 font-medium">{t.client_name}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{t.candidate_name}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{t.service_type}</TableCell>
                    <TableCell className="px-4 font-medium">
                      {ILS.format(t.net_invoice_amount ?? 0)}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">{t.payment_status}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
