import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fetchBonusEvents, buildBonusLedger, currentMonthKey, actualForecastProgress, type BonusEvent } from '@/lib/bonus'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { DateCell } from '@/components/ui/date-cell'
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

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')
const HE_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
]

const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתין',
  to_bill: 'לחיוב',
  billed: 'חויב',
  paid: 'שולם',
  cancelled: 'מבוטל',
}
// Green/emerald = paid (money received) only. billed = amber (awaiting
// payment); pending = gray (not yet actionable).
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-50 text-gray-700 border-gray-200',
  to_bill: 'bg-blue-50 text-blue-700 border-blue-200',
  billed: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  cancelled: 'bg-gray-50 text-gray-700 border-gray-200',
}

// 6 calendar months ending at todayKey, actual (paid, by payment_date) revenue
// per month — sourced from the shared ledger, so this chart can never drift
// from the hero card's own numbers.
function buildRecent6Months(ledger: Map<string, import('@/lib/bonus').LedgerMonth>, todayKey: string) {
  const [ty, tm] = todayKey.split('-').map(Number)
  const out: { label: string; revenue: number }[] = []
  for (let i = 5; i >= 0; i--) {
    let y = ty
    let m = tm - i
    while (m <= 0) { m += 12; y -= 1 }
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push({ label: `${HE_MONTHS[m - 1]} ${String(y).slice(2)}`, revenue: ledger.get(key)?.actualRevenue ?? 0 })
  }
  return out
}

export default function RecruiterDashboard() {
  const { profile } = useAuth()
  const todayKey = currentMonthKey()

  const { data: myEvents = [], isLoading, isError, refetch } = useQuery<BonusEvent[]>({
    queryKey: ['recruiter-dashboard-events', profile?.full_name],
    enabled: !!profile?.full_name,
    queryFn: () => fetchBonusEvents(supabase, { leadName: profile!.full_name }),
  })

  const tiers = useMemo(() => profile?.bonus_model?.tiers ?? [], [profile?.bonus_model])
  const ledger = useMemo(() => buildBonusLedger(myEvents, tiers, todayKey), [myEvents, tiers, todayKey])
  const month = ledger.get(todayKey) ?? {
    actualRevenue: 0, expectedRevenue: 0, forecastRevenue: 0, actualBonus: 0, forecastBonus: 0,
    isPast: false, isCurrent: true, events: [],
  }
  const monthRevenue = month.actualRevenue
  const monthForecastRevenue = month.forecastRevenue

  const monthEventCount = useMemo(
    () => myEvents.filter((ev) => (ev.billing_date ?? '').slice(0, 7) === todayKey).length,
    [myEvents, todayKey],
  )

  const openCount = useMemo(
    () => myEvents.filter((ev) => ev.status === 'to_bill').length,
    [myEvents],
  )

  // Current/next tier by ACTUAL revenue (fixes the below-first-tier bug: the
  // old calcBonusTier fell back to the lowest tier's bonus with `?? sorted[0]`
  // even when revenue hadn't reached it — showing e.g. ₪800 on ₪0 revenue).
  const { currentTier, nextTier, actualPct, forecastPct, amountToNext } =
    actualForecastProgress(monthRevenue, monthForecastRevenue, tiers)
  // Does the forecast reach a higher tier than the actual one?
  const forecastTier = useMemo(() => {
    const sorted = [...tiers].sort((a, b) => a.min - b.min)
    let fIdx = -1
    for (let i = 0; i < sorted.length; i++) {
      if (monthForecastRevenue >= sorted[i].min) fIdx = i
      else break
    }
    const curMin = currentTier?.min
    return fIdx >= 0 && sorted[fIdx].min !== curMin ? sorted[fIdx] : null
  }, [tiers, monthForecastRevenue, currentTier])

  const monthlyRevenue = useMemo(() => buildRecent6Months(ledger, todayKey), [ledger, todayKey])

  const recent5 = useMemo(() => {
    return [...myEvents]
      .sort((a, b) => (b.billing_date ?? '').localeCompare(a.billing_date ?? ''))
      .slice(0, 5)
  }, [myEvents])

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]" dir="rtl">
        <p className="text-muted-foreground text-sm">טוען נתונים...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-3" dir="rtl">
        <p className="text-sm text-destructive">שגיאה בטעינת נתוני הבונוס.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-sm text-purple-700 underline"
        >
          נסה שנית
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">דשבורד</h1>

      <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
        <CardContent className="p-6 space-y-4">
          <div>
            <p className="text-sm text-purple-800/80">הבונוס שלך החודש</p>
            <p className="text-5xl font-bold text-purple-900 mt-1">
              {ILS.format(month.actualBonus)}
            </p>
            {profile?.bonus_model && (
              <p className="text-sm text-purple-700/80 mt-1">
                תחזית לחודש: <span className="font-semibold text-purple-800">{ILS.format(month.forecastBonus)}</span>
              </p>
            )}
          </div>
          {profile?.bonus_model ? (
            <div className="space-y-2">
              {nextTier ? (
                <>
                  <div className="h-3 w-full rounded-full bg-purple-200 overflow-hidden relative">
                    <div className="h-full bg-purple-300 transition-all" style={{ width: `${forecastPct}%` }} />
                    <div className="h-full bg-purple-600 transition-all absolute inset-y-0 right-0" style={{ width: `${actualPct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-purple-900/80">
                    <span>{ILS.format(currentTier?.min ?? 0)}</span>
                    <span className="font-medium">הכנסה החודש: {ILS.format(monthRevenue)}</span>
                    <span>{ILS.format(nextTier.min)}</span>
                  </div>
                  <p className="text-sm text-purple-900 font-medium">
                    עוד {ILS.format(amountToNext)} למדרגת {ILS.format(nextTier.bonus)}
                  </p>
                  {forecastTier && (
                    <p className="text-xs text-purple-700/80">בתחזית: מדרגת {ILS.format(forecastTier.bonus)}</p>
                  )}
                </>
              ) : currentTier ? (
                <p className="text-sm text-purple-900 font-medium">הגעת למדרגה המקסימלית! 🎉</p>
              ) : (
                <p className="text-sm text-purple-900/80">טרם הגעת למדרגה הראשונה החודש. הכנסה החודש: {ILS.format(monthRevenue)}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-purple-900/80">המנהל עדיין לא הגדיר מודל בונוס.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">הכנסה החודש</CardTitle>
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
              <CardTitle className="text-sm font-medium text-muted-foreground">חיובים החודש</CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                <Receipt size={18} className="text-purple-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold leading-none">{NUM.format(monthEventCount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">לחיוב פתוחים</CardTitle>
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
              <Tooltip formatter={(v: unknown) => ILS.format(Number(v ?? 0))} cursor={{ fill: 'rgba(124,58,237,0.08)' }} />
              <Bar dataKey="revenue" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">חיובים אחרונים שלי</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right px-4">לקוח</TableHead>
                <TableHead className="text-right px-4">מועמד</TableHead>
                <TableHead className="text-right px-4">תאריך חיוב</TableHead>
                <TableHead className="text-right px-4">סכום</TableHead>
                <TableHead className="text-right px-4">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent5.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    אין חיובים להצגה
                  </TableCell>
                </TableRow>
              ) : (
                recent5.map((ev, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-4 font-medium">{ev.client_name ?? '—'}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{ev.candidate_name ?? '—'}</TableCell>
                    <TableCell className="px-4"><DateCell value={ev.billing_date} /></TableCell>
                    <TableCell className="px-4 font-medium">{ILS.format(ev.amount)}</TableCell>
                    <TableCell className="px-4">
                      <Badge variant="outline" className={`${STATUS_BADGE[ev.status] ?? ''} text-xs`}>
                        {STATUS_LABEL[ev.status] ?? ev.status}
                      </Badge>
                    </TableCell>
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
