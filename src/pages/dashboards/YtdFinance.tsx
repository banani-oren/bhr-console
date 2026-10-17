// Admin-dashboard year-to-date finance sections (Repair 22).
// Every number comes from src/lib/finance.ts. Two shared queries (events +
// transactions) plus the service_types lookup — no N+1; each section renders
// its own loading/error state so one failing query never blanks the page.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { FileText, Percent, TrendingUp, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  collectionRate,
  contractedInYear,
  fromAgorot,
  groupPaidEvents,
  jerusalemYearMonth,
  paidEventsInRange,
  sumEventIncome,
  sumEventInvoice,
  sumEventSupplier,
  toAgorot,
  yearBounds,
  type CollectionEvent,
  type FinanceTransaction,
} from '@/lib/finance'

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')
const PIE_COLORS = ['#4c1d95', '#7c3aed', '#a855f7', '#c084fc', '#8b5cf6', '#6d28d9', '#d8b4fe', '#5b21b6', '#e9d5ff']
const NO_TYPE = 'ללא סוג שירות'

type YtdEvent = CollectionEvent & {
  id: string
  transaction_id: string
  service_type_id: string | null
  service_type: string | null
}
type YtdTx = FinanceTransaction & {
  id: string
  service_type_id: string | null
  service_type: string | null
}

function useYtdData() {
  const events = useQuery<YtdEvent[]>({
    queryKey: ['admin-ytd-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select(
          'id, transaction_id, amount, supplier_amount, status, payment_date, invoice_date, invoice_number, transactions!inner ( service_type_id, service_type )',
        )
        .neq('status', 'cancelled')
        .limit(5000)
      if (error) throw error
      type Raw = Omit<YtdEvent, 'service_type_id' | 'service_type'> & {
        transactions: { service_type_id: string | null; service_type: string | null } | null
      }
      return ((data ?? []) as unknown as Raw[]).map((r) => ({
        ...r,
        service_type_id: r.transactions?.service_type_id ?? null,
        service_type: r.transactions?.service_type ?? null,
      }))
    },
  })
  const txs = useQuery<YtdTx[]>({
    queryKey: ['admin-ytd-transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, service_type_id, service_type, close_date, entry_date, period_start, net_invoice_amount, supplier_percent')
        .limit(5000)
      if (error) throw error
      return (data ?? []) as YtdTx[]
    },
  })
  const types = useQuery<{ id: string; name: string }[]>({
    queryKey: ['admin-ytd-service-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_types').select('id, name')
      if (error) throw error
      return (data ?? []) as { id: string; name: string }[]
    },
  })
  const nameById = useMemo(() => new Map((types.data ?? []).map((s) => [s.id, s.name])), [types.data])
  return { events, txs, types, nameById }
}

function ErrorCard({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="py-6 text-center text-sm text-red-600">
        {title}: אירעה שגיאה בטעינת הנתונים
      </CardContent>
    </Card>
  )
}

type KpiDef = { title: string; value: string; sub: string; tip: string; icon: React.ReactNode; iconBg: string }

export function YtdKpiRow() {
  const { events, txs, types, nameById } = useYtdData()
  const { year } = jerusalemYearMonth()

  const k = useMemo(() => {
    if (!events.data || !txs.data) return null
    const { from, to } = yearBounds(year)
    const paid = paidEventsInRange(events.data, from, to)
    const contracted = contractedInYear(txs.data, year, (t) => (t.service_type_id && nameById.get(t.service_type_id)) || t.service_type)
    return {
      received: sumEventInvoice(paid),
      supplier: sumEventSupplier(paid),
      income: sumEventIncome(paid),
      contracted,
      rate: collectionRate(events.data, year),
    }
  }, [events.data, txs.data, nameById, year])

  if (events.isError || txs.isError || types.isError) return <ErrorCard title="מתחילת השנה" />
  if (!k) return <p className="text-sm text-muted-foreground">טוען נתונים...</p>

  const cards: KpiDef[] = [
    {
      title: 'סכום חשבוניות בחוזים',
      value: ILS.format(k.contracted.invoice),
      sub: `${NUM.format(k.contracted.count)} עסקאות`,
      tip: 'סכום חשבונית של עסקאות שתאריך העסקה שלהן השנה',
      icon: <FileText size={20} className="text-purple-600" />,
      iconBg: 'bg-purple-50',
    },
    {
      title: 'עמלות ספקים',
      value: ILS.format(k.supplier),
      sub: `בחוזים: ${ILS.format(k.contracted.supplier)}`,
      tip: 'עמלת ספק של תשלומים שהתקבלו, לפי תאריך תשלום',
      icon: <Wallet size={20} className="text-purple-600" />,
      iconBg: 'bg-purple-50',
    },
    {
      title: 'הכנסה',
      value: ILS.format(k.income),
      sub: `בחוזים: ${ILS.format(k.contracted.income)}`,
      tip: 'סכום חשבונית פחות עמלת ספק, לפי תאריך תשלום',
      icon: <TrendingUp size={20} className="text-green-600" />,
      iconBg: 'bg-green-50',
    },
    {
      title: 'אחוז גבייה',
      value: k.rate.pct == null ? '—' : `${Math.round(k.rate.pct)}%`,
      sub: k.rate.pct == null ? 'אין חשבונות עסקה השנה' : `${ILS.format(k.rate.paid)} מתוך ${ILS.format(k.rate.invoiced)}`,
      tip: 'סכום ששולם מתוך סכום חשבונות העסקה שהופקו השנה',
      icon: <Percent size={20} className="text-amber-600" />,
      iconBg: 'bg-amber-50',
    },
  ]

  return (
    <section className="space-y-3" data-testid="ytd-kpis">
      <h2 className="text-lg font-semibold text-foreground">מתחילת השנה – {year}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title} title={c.tip}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.iconBg}`}>{c.icon}</span>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground leading-none">{c.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

export function ServiceTypeBreakdown() {
  const { events, types, nameById } = useYtdData()
  const { year } = jerusalemYearMonth()

  const data = useMemo(() => {
    if (!events.data) return null
    const { from, to } = yearBounds(year)
    const paid = paidEventsInRange(events.data, from, to)
    const nameOf = (e: YtdEvent) =>
      ((e.service_type_id && nameById.get(e.service_type_id)) || e.service_type || '').trim() || NO_TYPE
    const rows = groupPaidEvents(paid, nameOf)
    const totalIncomeA = rows.reduce((s, r) => s + toAgorot(r.income), 0)
    return {
      rows: rows.map((r) => ({ ...r, pct: totalIncomeA > 0 ? (toAgorot(r.income) / totalIncomeA) * 100 : 0 })),
      invoice: fromAgorot(rows.reduce((s, r) => s + toAgorot(r.invoice), 0)),
      income: fromAgorot(totalIncomeA),
      deals: new Set(paid.map((e) => e.transaction_id)).size,
    }
  }, [events.data, nameById, year])

  const title = 'הכנסה לפי סוג שירות – מתחילת השנה'
  if (events.isError || types.isError) return <ErrorCard title={title} />
  if (!data) return <p className="text-sm text-muted-foreground">טוען נתונים...</p>

  return (
    <Card data-testid="service-type-breakdown">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">אין הכנסות מתחילת השנה</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">סוג שירות</TableHead>
                    <TableHead className="text-right">עסקאות</TableHead>
                    <TableHead className="text-right">סכום חשבונית</TableHead>
                    <TableHead className="text-right">הכנסה</TableHead>
                    <TableHead className="text-right">% מההכנסה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r, i) => (
                    <TableRow key={r.key}>
                      <TableCell className="text-right font-medium">
                        <span className="inline-block w-2.5 h-2.5 rounded-full ml-2 align-middle" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {r.label}
                      </TableCell>
                      <TableCell className="text-right">{NUM.format(r.deals)}</TableCell>
                      <TableCell className="text-right">{ILS.format(r.invoice)}</TableCell>
                      <TableCell className="text-right">{ILS.format(r.income)}</TableCell>
                      <TableCell className="text-right">{r.pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-purple-50 hover:bg-purple-50 font-semibold text-purple-900">
                    <TableCell className="text-right">סה"כ</TableCell>
                    <TableCell className="text-right">{NUM.format(data.deals)}</TableCell>
                    <TableCell className="text-right">{ILS.format(data.invoice)}</TableCell>
                    <TableCell className="text-right">{ILS.format(data.income)}</TableCell>
                    <TableCell className="text-right">100%</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.rows.filter((r) => r.income > 0)}
                    dataKey="income"
                    nameKey="label"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={1}
                  >
                    {data.rows.filter((r) => r.income > 0).map((r) => (
                      <Cell key={r.key} fill={PIE_COLORS[data.rows.indexOf(r) % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as { label: string; income: number; pct: number }
                      return (
                        <div dir="rtl" className="rounded-lg bg-popover px-3 py-2 text-sm shadow-md ring-1 ring-foreground/10">
                          <p className="font-medium text-foreground">{p.label}</p>
                          <p className="text-muted-foreground">{ILS.format(p.income)} · {p.pct.toFixed(1)}%</p>
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
