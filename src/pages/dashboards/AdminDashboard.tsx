import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  Cell,
} from 'recharts'
import {
  FileText,
  Clock,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react'

const CHART_COLORS = ['#7c3aed', '#a855f7', '#c084fc', '#e9d5ff', '#8b5cf6']
const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')

const HE_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
]

type EventRow = {
  id: string
  amount: number
  supplier_amount: number
  billing_date: string | null
  payment_date: string | null
  status: string
  invoice_number: string | null
  description: string | null
  client_name: string | null
  service_lead: string | null
  approved: boolean
}

type RawEventRow = {
  id: string
  amount: number | string | null
  supplier_amount: number | string | null
  billing_date: string | null
  payment_date: string | null
  status: string
  invoice_number: string | null
  description: string | null
  transactions: { client_name: string | null; service_lead: string | null; needs_approval: boolean; approved_at: string | null } | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתין',
  to_bill: 'לחיוב',
  billed: 'חויב',
  cancelled: 'מבוטל',
}
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  to_bill: 'bg-blue-50 text-blue-700 border-blue-200',
  billed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-50 text-gray-700 border-gray-200',
}

function buildMonthlyRevenue(events: EventRow[]) {
  const now = new Date()
  const months: { label: string; year: number; month: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: `${HE_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    })
  }
  return months.map(({ label, year, month }) => {
    const revenue = events.reduce((sum, ev) => {
      if (!ev.billing_date) return sum
      const d = new Date(ev.billing_date)
      if (isNaN(d.getTime())) return sum
      if (d.getFullYear() === year && d.getMonth() + 1 === month) return sum + ev.amount
      return sum
    }, 0)
    return { label, revenue }
  })
}

function buildLeadRevenue(events: EventRow[]) {
  const totals: Record<string, number> = {}
  for (const ev of events) {
    if (!ev.approved) continue
    const lead = ev.service_lead ?? 'לא ידוע'
    totals[lead] = (totals[lead] ?? 0) + (ev.amount - ev.supplier_amount)
  }
  return Object.entries(totals)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
}

function RevenueTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-sm shadow-md ring-1 ring-foreground/10">
      <p className="font-medium text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">{ILS.format(payload[0].value)}</p>
    </div>
  )
}

export default function AdminDashboard() {
  const { data: billingEvents = [], isLoading } = useQuery<EventRow[]>({
    queryKey: ['admin-dashboard-billing-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select(`
          id, amount, supplier_amount, billing_date, payment_date, status, invoice_number, description,
          transactions!inner ( client_name, service_lead, needs_approval, approved_at )
        `)
        .neq('status', 'cancelled')
      if (error) throw error
      const rows = (data ?? []) as unknown as RawEventRow[]
      return rows.map((row) => ({
        id: row.id,
        amount: Number(row.amount) || 0,
        supplier_amount: Number(row.supplier_amount) || 0,
        billing_date: row.billing_date,
        payment_date: row.payment_date,
        status: row.status,
        invoice_number: row.invoice_number,
        description: row.description,
        client_name: row.transactions?.client_name ?? null,
        service_lead: row.transactions?.service_lead ?? null,
        approved: !row.transactions?.needs_approval || row.transactions?.approved_at != null,
      }))
    },
  })

  const stats = useMemo(() => {
    const now = new Date()
    const curYear = now.getFullYear()
    const curMonth = now.getMonth() + 1

    let toBillCount = 0
    let toBillSum = 0
    let pendingPaymentSum = 0
    let pendingPaymentCount = 0
    let collectedThisMonth = 0
    let collectedYTD = 0

    for (const ev of billingEvents) {
      if (ev.status === 'to_bill') {
        toBillCount += 1
        toBillSum += ev.amount
      }
      if (ev.status === 'billed' && !ev.payment_date) {
        pendingPaymentSum += ev.amount
        pendingPaymentCount += 1
      }
      if (ev.payment_date) {
        const pd = new Date(ev.payment_date)
        if (!isNaN(pd.getTime())) {
          if (pd.getFullYear() === curYear) collectedYTD += ev.amount
          if (pd.getFullYear() === curYear && pd.getMonth() + 1 === curMonth) collectedThisMonth += ev.amount
        }
      }
    }
    return { toBillCount, toBillSum, pendingPaymentSum, pendingPaymentCount, collectedThisMonth, collectedYTD }
  }, [billingEvents])

  const monthlyRevenue = useMemo(() => buildMonthlyRevenue(billingEvents), [billingEvents])
  const leadRevenue = useMemo(() => buildLeadRevenue(billingEvents), [billingEvents])

  const recentEvents = useMemo(() => {
    return [...billingEvents]
      .sort((a, b) => (b.billing_date ?? '').localeCompare(a.billing_date ?? ''))
      .slice(0, 10)
  }, [billingEvents])

  const upcomingEvents = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return [...billingEvents]
      .filter((ev) => (ev.status === 'pending' || ev.status === 'to_bill') && ev.billing_date && ev.billing_date >= today)
      .sort((a, b) => (a.billing_date ?? '').localeCompare(b.billing_date ?? ''))
      .slice(0, 5)
  }, [billingEvents])

  const kpiCards = [
    {
      title: 'לחיוב',
      value: NUM.format(stats.toBillCount),
      icon: <FileText size={20} className="text-amber-600" />,
      iconBg: 'bg-amber-50',
      sub: ILS.format(stats.toBillSum),
    },
    {
      title: 'ממתין לתשלום',
      value: ILS.format(stats.pendingPaymentSum),
      icon: <Clock size={20} className="text-purple-600" />,
      iconBg: 'bg-purple-50',
      sub: `${NUM.format(stats.pendingPaymentCount)} חיובים`,
    },
    {
      title: 'תקבולים החודש',
      value: ILS.format(stats.collectedThisMonth),
      icon: <CheckCircle2 size={20} className="text-green-600" />,
      iconBg: 'bg-green-50',
      sub: 'תקבולים שנכנסו החודש',
    },
    {
      title: 'תקבולים YTD',
      value: ILS.format(stats.collectedYTD),
      icon: <TrendingUp size={20} className="text-purple-600" />,
      iconBg: 'bg-purple-50',
      sub: 'מתחילת השנה',
    },
  ]

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground text-sm">טוען נתונים...</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">דשבורד</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.iconBg}`}>{card.icon}</span>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground leading-none">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">הכנסות חודשיות – 12 חודשים אחרונים</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyRevenue} margin={{ top: 4, right: 4, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Bar dataKey="revenue" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">חיובים קרובים</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">אין חיובים קרובים</p>
            ) : (
              <ul className="space-y-2">
                {upcomingEvents.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between border-b border-border/50 last:border-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ev.client_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground"><DateCell value={ev.billing_date} /></p>
                    </div>
                    <span className="text-sm font-semibold whitespace-nowrap">{ILS.format(ev.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">הכנסות נטו לפי מוביל שירות</CardTitle>
        </CardHeader>
        <CardContent>
          {leadRevenue.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">אין נתונים להצגה</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, leadRevenue.length * 36)}>
              <BarChart data={leadRevenue} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={100} />
                <Tooltip content={<RevenueTooltip />} />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={32}>
                  {leadRevenue.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">חיובים אחרונים</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right px-4">לקוח</TableHead>
                <TableHead className="text-right px-4">תיאור</TableHead>
                <TableHead className="text-right px-4">תאריך חיוב</TableHead>
                <TableHead className="text-right px-4">סכום</TableHead>
                <TableHead className="text-right px-4">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    אין חיובים להצגה
                  </TableCell>
                </TableRow>
              ) : (
                recentEvents.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="px-4 font-medium">{ev.client_name ?? '—'}</TableCell>
                    <TableCell className="px-4 text-xs text-muted-foreground">{ev.description ?? '—'}</TableCell>
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
