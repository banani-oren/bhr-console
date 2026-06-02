import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { BonusModel } from '@/lib/types'
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

type EventRow = {
  amount: number
  supplier_amount: number
  billing_date: string | null
  payment_date: string | null
  status: string
  client_name: string | null
  candidate_name: string | null
  service_type: string | null
  description: string | null
}

type RawEventRow = {
  amount: number | string | null
  supplier_amount: number | string | null
  billing_date: string | null
  payment_date: string | null
  status: string
  description: string | null
  transactions: { client_name: string | null; candidate_name: string | null; service_type: string | null; service_lead: string | null; needs_approval: boolean; approved_at: string | null } | null
}

function calcBonusTier(rev: number, model: BonusModel | null | undefined) {
  if (!model?.tiers?.length) return null
  const sorted = [...model.tiers].sort((a, b) => a.min - b.min)
  const currentTier = [...sorted].reverse().find((t) => rev >= t.min) ?? sorted[0]
  const currentIdx = sorted.findIndex((t) => t.min === currentTier.min)
  const nextTier = currentIdx + 1 < sorted.length ? sorted[currentIdx + 1] : null
  return { sorted, currentTier, nextTier }
}

function buildRecent6Months(events: EventRow[]) {
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
    const revenue = events.reduce((sum, ev) => {
      // Income = money received = paid events, bucketed by payment_date —
      // consistent with the bonus engine (src/lib/bonus.ts).
      if (ev.status !== 'paid' || !ev.payment_date) return sum
      const d = new Date(ev.payment_date)
      if (isNaN(d.getTime())) return sum
      if (d.getFullYear() === year && d.getMonth() + 1 === month) return sum + (ev.amount - ev.supplier_amount)
      return sum
    }, 0)
    return { label, revenue }
  })
}

export default function RecruiterDashboard() {
  const { profile } = useAuth()

  const { data: myEvents = [], isLoading } = useQuery<EventRow[]>({
    queryKey: ['recruiter-dashboard-events', profile?.full_name],
    enabled: !!profile?.full_name,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select(`
          amount, supplier_amount, billing_date, payment_date, status, description,
          transactions!inner ( client_name, candidate_name, service_type, service_lead, needs_approval, approved_at )
        `)
        .neq('status', 'cancelled')
        .ilike('transactions.service_lead', profile!.full_name)
      if (error) throw error
      const rows = (data ?? []) as unknown as RawEventRow[]
      return rows
        .filter((row) => row.transactions && (!row.transactions.needs_approval || row.transactions.approved_at != null))
        .map((row) => ({
          amount: Number(row.amount) || 0,
          supplier_amount: Number(row.supplier_amount) || 0,
          billing_date: row.billing_date,
          payment_date: row.payment_date,
          status: row.status,
          description: row.description,
          client_name: row.transactions?.client_name ?? null,
          candidate_name: row.transactions?.candidate_name ?? null,
          service_type: row.transactions?.service_type ?? null,
        }))
    },
  })

  const now = new Date()
  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1

  const monthRevenue = useMemo(() => {
    return myEvents.reduce((sum, ev) => {
      // Income = money received = paid events, by payment_date — matches the
      // bonus engine so the displayed bonus reflects what will actually be paid.
      if (ev.status !== 'paid' || !ev.payment_date) return sum
      const d = new Date(ev.payment_date)
      if (isNaN(d.getTime())) return sum
      if (d.getFullYear() === curYear && d.getMonth() + 1 === curMonth) {
        return sum + (ev.amount - ev.supplier_amount)
      }
      return sum
    }, 0)
  }, [myEvents, curYear, curMonth])

  const monthEventCount = useMemo(() => {
    return myEvents.filter((ev) => {
      if (!ev.billing_date) return false
      const d = new Date(ev.billing_date)
      return !isNaN(d.getTime()) && d.getFullYear() === curYear && d.getMonth() + 1 === curMonth
    }).length
  }, [myEvents, curYear, curMonth])

  const openCount = useMemo(
    () => myEvents.filter((ev) => ev.status === 'to_bill').length,
    [myEvents],
  )

  const bonusInfo = calcBonusTier(monthRevenue, profile?.bonus_model)
  const monthlyRevenue = useMemo(() => buildRecent6Months(myEvents), [myEvents])

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
                    <div className="h-full bg-purple-600 transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-purple-900/80">
                    <span>{ILS.format(bonusInfo.currentTier.min)}</span>
                    <span className="font-medium">הכנסה החודש: {ILS.format(monthRevenue)}</span>
                    <span>{ILS.format(bonusInfo.nextTier.min)}</span>
                  </div>
                  <p className="text-sm text-purple-900 font-medium">
                    עוד {ILS.format(remainingToNext)} למדרגת {ILS.format(bonusInfo.nextTier.bonus)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-purple-900 font-medium">הגעת למדרגה המקסימלית! 🎉</p>
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
