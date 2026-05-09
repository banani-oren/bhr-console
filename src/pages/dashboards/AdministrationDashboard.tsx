import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DateCell } from '@/components/ui/date-cell'
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
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { AlertTriangle, CheckCircle2, FileText, Wallet } from 'lucide-react'

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')
const HE_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
]
const AGING_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#7f1d1d']

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

export default function AdministrationDashboard() {
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

    let billedThisMonth = 0
    let collectedThisMonth = 0
    let openAmount = 0
    let awaitingInvoice = 0
    let overdueAmount = 0
    const buckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }
    const topOverdue: { id: string; clientName: string; description: string; amount: number; billingDate: Date; daysOverdue: number }[] = []

    for (const ev of billingEvents) {
      const billingDate = ev.billing_date ? new Date(ev.billing_date) : null
      const paymentDate = ev.payment_date ? new Date(ev.payment_date) : null

      if (ev.status === 'to_bill') awaitingInvoice += 1

      if (billingDate && !isNaN(billingDate.getTime())) {
        if (billingDate.getFullYear() === curYear && billingDate.getMonth() + 1 === curMonth) {
          billedThisMonth += ev.amount
        }
      }

      if (paymentDate && !isNaN(paymentDate.getTime())) {
        if (paymentDate.getFullYear() === curYear && paymentDate.getMonth() + 1 === curMonth) {
          collectedThisMonth += ev.amount
        }
      } else if (ev.status === 'billed') {
        openAmount += ev.amount
        if (billingDate && billingDate < now) {
          const daysOverdue = Math.floor((now.getTime() - billingDate.getTime()) / 86400000)
          overdueAmount += ev.amount
          topOverdue.push({
            id: ev.id,
            clientName: ev.client_name ?? '—',
            description: ev.description ?? '—',
            amount: ev.amount,
            billingDate,
            daysOverdue,
          })
          if (daysOverdue <= 30) buckets.b0_30 += ev.amount
          else if (daysOverdue <= 60) buckets.b31_60 += ev.amount
          else if (daysOverdue <= 90) buckets.b61_90 += ev.amount
          else buckets.b90plus += ev.amount
        }
      } else if (ev.status === 'to_bill' || ev.status === 'pending') {
        // not billed yet — counts toward open if billed, else just future receivables
        // (also treat to_bill with past billing_date as open + overdue display)
        if (ev.status === 'to_bill' && billingDate && billingDate < now) {
          const daysOverdue = Math.floor((now.getTime() - billingDate.getTime()) / 86400000)
          overdueAmount += ev.amount
          topOverdue.push({
            id: ev.id,
            clientName: ev.client_name ?? '—',
            description: ev.description ?? '—',
            amount: ev.amount,
            billingDate,
            daysOverdue,
          })
          if (daysOverdue <= 30) buckets.b0_30 += ev.amount
          else if (daysOverdue <= 60) buckets.b31_60 += ev.amount
          else if (daysOverdue <= 90) buckets.b61_90 += ev.amount
          else buckets.b90plus += ev.amount
        }
      }
    }

    topOverdue.sort((a, b) => b.daysOverdue - a.daysOverdue)
    return {
      billedThisMonth,
      collectedThisMonth,
      openAmount,
      overdueAmount,
      awaitingInvoice,
      buckets,
      topOverdue: topOverdue.slice(0, 10),
    }
  }, [billingEvents])

  const collectionPct = stats.billedThisMonth > 0
    ? Math.min(100, Math.round((stats.collectedThisMonth / stats.billedThisMonth) * 100))
    : 0

  const agingData = [
    { name: '0–30', value: stats.buckets.b0_30 },
    { name: '31–60', value: stats.buckets.b31_60 },
    { name: '61–90', value: stats.buckets.b61_90 },
    { name: '90+', value: stats.buckets.b90plus },
  ].filter((d) => d.value > 0)

  // 6-month collections
  const monthlyCollections = useMemo(() => {
    const now = new Date()
    const out: { label: string; value: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const label = `${HE_MONTHS[d.getMonth()]} ${String(year).slice(2)}`
      const total = billingEvents
        .filter((ev) => {
          if (!ev.payment_date) return false
          const pd = new Date(ev.payment_date)
          return !isNaN(pd.getTime()) && pd.getFullYear() === year && pd.getMonth() + 1 === month
        })
        .reduce((s, ev) => s + ev.amount, 0)
      out.push({ label, value: total })
    }
    return out
  }, [billingEvents])

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]" dir="rtl">
        <p className="text-muted-foreground text-sm">טוען נתונים...</p>
      </div>
    )
  }

  const remaining = Math.max(0, stats.billedThisMonth - stats.collectedThisMonth)

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">דשבורד גבייה</h1>

      <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm text-purple-800/80">גבייה החודש</p>
              <p className="text-4xl font-bold text-purple-900 mt-1">{collectionPct}%</p>
            </div>
            <p className="text-sm text-purple-900 font-medium">
              {ILS.format(stats.collectedThisMonth)} נגבו מתוך {ILS.format(stats.billedThisMonth)}
            </p>
          </div>
          <div className="h-3 w-full rounded-full bg-purple-200 overflow-hidden">
            <div className="h-full bg-purple-600 transition-all" style={{ width: `${collectionPct}%` }} />
          </div>
          <p className="text-sm text-purple-900">עוד {ILS.format(remaining)} לגבייה</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">סכום לגבייה כעת</CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                <Wallet size={18} className="text-purple-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold leading-none">{ILS.format(stats.openAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">חורג מתאריך חיוב</CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
                <AlertTriangle size={18} className="text-red-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-700 leading-none">{ILS.format(stats.overdueAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">נגבה החודש</CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50">
                <CheckCircle2 size={18} className="text-green-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700 leading-none">{ILS.format(stats.collectedThisMonth)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">ממתינים לחשבונית</CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
                <FileText size={18} className="text-amber-600" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold leading-none">{NUM.format(stats.awaitingInvoice)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">גיול חובות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {agingData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">אין חוב חורג לתצוגה</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={agingData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {agingData.map((_, i) => (
                        <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: unknown) => ILS.format(Number(v ?? 0))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                  {agingData.map((entry, i) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: AGING_COLORS[i % AGING_COLORS.length] }}
                      />
                      <span className="text-muted-foreground">{entry.name} ימים</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">גבייה ב-6 חודשים אחרונים</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlyCollections} margin={{ top: 4, right: 4, left: 8, bottom: 4 }}>
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
                <Bar dataKey="value" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">10 חיובים חורגים בעדיפות גבוהה</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right px-4">לקוח</TableHead>
                <TableHead className="text-right px-4">סכום</TableHead>
                <TableHead className="text-right px-4">תאריך חיוב</TableHead>
                <TableHead className="text-right px-4">ימי איחור</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.topOverdue.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    אין חיובים חורגים
                  </TableCell>
                </TableRow>
              ) : (
                stats.topOverdue.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="px-4 font-medium">{row.clientName}</TableCell>
                    <TableCell className="px-4 font-medium">{ILS.format(row.amount)}</TableCell>
                    <TableCell className="px-4 text-muted-foreground" dir="ltr">
                      <DateCell value={row.billingDate} />
                    </TableCell>
                    <TableCell className="px-4">
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700">
                        {row.daysOverdue} ימים
                      </span>
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
