import { Fragment, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePendingApprovals } from '@/hooks/usePendingApprovals'
import type { Transaction } from '@/lib/types'
import TransactionDialog from '@/components/TransactionDialog'
import BonusWidget from '@/components/BonusWidget'
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
import { Button } from '@/components/ui/button'
import { DateCell, DueDateCell } from '@/components/ui/date-cell'
import { groupPaidEvents, jerusalemYearMonth, paidEventsInRange, sumEventIncome, sumEventInvoice, toAgorot, yearBounds } from '@/lib/finance'
import { normalizeLead } from '@/lib/bonus'
import { YtdKpiRow, ServiceTypeBreakdown } from './YtdFinance'
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
  Check,
  Pencil,
  Loader2,
  ChevronDown,
  ChevronUp,
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
  transaction_id: string
  amount: number
  supplier_amount: number
  billing_date: string | null
  payment_date: string | null
  due_date: string | null
  status: string
  invoice_number: string | null
  description: string | null
  client_name: string | null
  service_lead: string | null
  approved: boolean
}

type RawEventRow = {
  id: string
  transaction_id: string
  amount: number | string | null
  supplier_amount: number | string | null
  billing_date: string | null
  payment_date: string | null
  due_date: string | null
  status: string
  invoice_number: string | null
  description: string | null
  transactions: { client_name: string | null; service_lead: string | null; needs_approval: boolean; approved_at: string | null } | null
}

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

function buildMonthlyRevenue(events: EventRow[]) {
  // 12 calendar months ending at the current Jerusalem month. Month keys are
  // 'YYYY-MM' strings (never new Date(payment_date) — timezone drift). The
  // value is הכנסה (invoice − supplier) of PAID events by payment_date.
  const { year: cy, month: cm } = jerusalemYearMonth()
  const months: { label: string; key: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const idx = cy * 12 + (cm - 1) - i
    const y = Math.floor(idx / 12)
    const m = (idx % 12) + 1
    months.push({ label: `${HE_MONTHS[m - 1]} ${String(y).slice(2)}`, key: `${y}-${String(m).padStart(2, '0')}` })
  }
  return months.map(({ label, key }) => {
    const inMonth = paidEventsInRange(events, `${key}-01`, `${key}-31`)
    return { label, revenue: sumEventIncome(inMonth) }
  })
}

function buildLeadRevenue(events: EventRow[]) {
  // הכנסה by lead, current calendar year, all paid events by payment_date
  // (approval is not a filter). Leads are matched with bonus.ts's
  // normalizeLead(); `deals` = distinct transactions with ≥1 paid event.
  const { year } = jerusalemYearMonth()
  const { from, to } = yearBounds(year)
  const paid = paidEventsInRange(events, from, to)
  return groupPaidEvents(
    paid,
    (e) => normalizeLead(e.service_lead) || 'לא ידוע',
    (e) => (e.service_lead ?? '').trim() || 'לא ידוע',
  ).map((g) => ({ name: g.label, revenue: g.income, deals: g.deals, axisLabel: `${g.label} · ${g.deals} עסקאות` }))
}

function LeadTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: { name: string; revenue: number; deals: number } }[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-sm shadow-md ring-1 ring-foreground/10">
      <p className="font-medium text-foreground mb-1">{p.name}</p>
      <p className="text-muted-foreground">{ILS.format(p.revenue)} · {p.deals} עסקאות</p>
    </div>
  )
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

function getCandidateName(t: Transaction): string {
  if (t.candidate_name) return t.candidate_name
  const custom = t.custom_fields?.candidate_name
  return typeof custom === 'string' && custom ? custom : '—'
}

function PendingApprovalsCard() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: pending = [] } = usePendingApprovals(true)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleApprove = async (txnId: string) => {
    setApprovingId(txnId)
    setApproveError(null)
    // 10s abort so a hung approve can't freeze the row's button.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from('transactions')
        .update({ approved_by: profile!.id, approved_at: nowIso })
        .eq('id', txnId)
        .abortSignal(controller.signal)
      if (error) throw error
      // Move pending events whose billing_date has passed to to_bill (mirrors
      // the approve action on the Transactions page for consistent behavior).
      const today = new Date().toISOString().slice(0, 10)
      await supabase
        .from('billing_events')
        .update({ status: 'to_bill' })
        .eq('transaction_id', txnId)
        .eq('status', 'pending')
        .lte('billing_date', today)
        .abortSignal(controller.signal)
      queryClient.invalidateQueries({ queryKey: ['pending_approvals'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['billing_events'] })
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setApproveError(isTimeout ? 'האישור לא הושלם — פג זמן. נסה שנית.' : 'שגיאה באישור — נסה שנית')
    } finally {
      clearTimeout(timer)
      setApprovingId(null)
    }
  }

  if (pending.length === 0) return null

  return (
    <>
      <Card className="border-amber-200">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-amber-800">
            ממתין לאישור ({pending.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 space-y-2">
          {approveError && <p className="px-4 text-sm text-destructive">{approveError}</p>}

          {/* Desktop table */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right px-4">לקוח</TableHead>
                  <TableHead className="text-right px-4">שירות</TableHead>
                  <TableHead className="text-right px-4">מועמד</TableHead>
                  <TableHead className="text-right px-4">מוביל</TableHead>
                  <TableHead className="text-right px-4">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="px-4 font-medium">{t.client_name}</TableCell>
                    <TableCell className="px-4">{t.service_type}</TableCell>
                    <TableCell className="px-4">{getCandidateName(t)}</TableCell>
                    <TableCell className="px-4">{t.service_lead || '—'}</TableCell>
                    <TableCell className="px-4">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void handleApprove(t.id)}
                          disabled={approvingId === t.id}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          {approvingId === t.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Check className="h-4 w-4" /> אשר
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setEditing(t); setDialogOpen(true) }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile (375px): simple list — client name + actions only */}
          <ul className="sm:hidden divide-y divide-border px-4">
            {pending.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm font-medium truncate">{t.client_name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => void handleApprove(t.id)}
                    disabled={approvingId === t.id}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {approvingId === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditing(t); setDialogOpen(true) }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <TransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </>
  )
}

type ScheduleRow = {
  id: string
  amount: number
  description: string | null
  dueDate: string | null
  dueDateIsManual: boolean
  invoiceDate: string | null
  clientName: string | null
}

// Groups schedule rows (already sorted ascending by due date, nulls last) into
// contiguous per-month buckets for the cash-flow subtotal display. Rows with
// no due_date — a client with missing/unparseable payment terms (Repair 18;
// every row here is `billed`, so it always has a real invoice_date — a NULL
// due_date here always means terms are missing, never "not yet invoiced":
// that state belongs to the טרם חויב KPI above, not this widget, which only
// ever queries status='billed') — fall into a trailing "ללא תאריך תשלום
// צפוי" group, so the money stays visible rather than silently dropping out
// of the cash-flow view.
function groupByDueMonth(rows: ScheduleRow[]) {
  const groups: { key: string; label: string; rows: ScheduleRow[]; subtotal: number }[] = []
  for (const r of rows) {
    const key = r.dueDate ? r.dueDate.slice(0, 7) : 'none'
    let group = groups.at(-1)?.key === key ? groups.at(-1) : undefined
    if (!group) {
      const label = r.dueDate
        ? format(new Date(`${r.dueDate}T00:00:00`), 'MMMM yyyy', { locale: he })
        : 'ללא תאריך תשלום צפוי'
      group = { key, label, rows: [], subtotal: 0 }
      groups.push(group)
    }
    group.rows.push(r)
    group.subtotal = (toAgorot(group.subtotal) + toAgorot(r.amount)) / 100
  }
  return groups
}

function ExpectedPaymentSchedule() {
  const { profile } = useAuth()
  const storageKey = `bhr_payment_schedule_collapsed_${profile?.id ?? 'anon'}`
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(storageKey) === '1'
  })

  const { data: rows = [] } = useQuery<ScheduleRow[]>({
    queryKey: ['admin-dashboard-payment-schedule'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select('id, amount, description, due_date, due_date_is_manual, invoice_date, transactions!inner(client_name)')
        .eq('status', 'billed')
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      const list = (data ?? []) as unknown as {
        id: string
        amount: number | string | null
        description: string | null
        due_date: string | null
        due_date_is_manual: boolean
        invoice_date: string | null
        transactions: { client_name: string | null } | null
      }[]
      return list.map((r) => ({
        id: r.id,
        amount: Number(r.amount) || 0,
        description: r.description,
        dueDate: r.due_date,
        dueDateIsManual: r.due_date_is_manual,
        invoiceDate: r.invoice_date,
        clientName: r.transactions?.client_name ?? null,
      }))
    },
  })

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(storageKey, next ? '1' : '0')
      return next
    })
  }

  if (rows.length === 0) return null

  const total = rows.reduce((sum, r) => sum + toAgorot(r.amount), 0) / 100
  const groups = groupByDueMonth(rows)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-semibold">לוח תשלומים צפוי</CardTitle>
        <Button size="sm" variant="ghost" onClick={toggle} className="gap-1 text-xs text-muted-foreground">
          {collapsed ? <><ChevronDown className="h-4 w-4" /> הצג</> : <><ChevronUp className="h-4 w-4" /> הסתר</>}
        </Button>
      </CardHeader>
      {!collapsed && (
        <>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right px-4">לקוח</TableHead>
                  <TableHead className="text-right px-4">תאריך הפקה</TableHead>
                  <TableHead className="text-right px-4">תיאור</TableHead>
                  <TableHead className="text-right px-4">סכום</TableHead>
                  <TableHead className="text-right px-4">תאריך תשלום צפוי</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {g.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="px-4 font-medium">{r.clientName ?? '—'}</TableCell>
                        <TableCell className="px-4"><DateCell value={r.invoiceDate} /></TableCell>
                        <TableCell className="px-4 text-xs text-muted-foreground">{r.description ?? '—'}</TableCell>
                        <TableCell className="px-4 font-medium">{ILS.format(r.amount)}</TableCell>
                        <TableCell className="px-4"><DueDateCell dueDate={r.dueDate} isManual={r.dueDateIsManual} hasBasis={!!r.invoiceDate} /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={3} className="px-4 text-xs text-muted-foreground">סה"כ {g.label}</TableCell>
                      <TableCell className="px-4 text-xs font-semibold text-amber-700">{ILS.format(g.subtotal)}</TableCell>
                      <TableCell className="px-4" />
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t text-sm">
            <span className="text-muted-foreground">סה"כ לגבייה:</span>
            <span className="font-semibold text-amber-700">{ILS.format(total)}</span>
          </div>
        </>
      )}
    </Card>
  )
}

export default function AdminDashboard() {
  const { data: billingEvents = [], isLoading } = useQuery<EventRow[]>({
    queryKey: ['admin-dashboard-billing-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select(`
          id, transaction_id, amount, supplier_amount, billing_date, payment_date, due_date, status, invoice_number, description,
          transactions!inner ( client_name, service_lead, needs_approval, approved_at )
        `)
        .neq('status', 'cancelled')
      if (error) throw error
      const rows = (data ?? []) as unknown as RawEventRow[]
      return rows.map((row) => ({
        id: row.id,
        transaction_id: row.transaction_id,
        amount: Number(row.amount) || 0,
        supplier_amount: Number(row.supplier_amount) || 0,
        billing_date: row.billing_date,
        payment_date: row.payment_date,
        due_date: row.due_date,
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
    const { year: curYear, month: curMonth } = jerusalemYearMonth()
    const curMonthKey = `${curYear}-${String(curMonth).padStart(2, '0')}`

    // Repair 17: vocabulary aligned with the collection model / דוח צפי גבייה —
    // טרם חויב = pending + to_bill (not yet invoiced); ממתין לתשלום = billed
    // only (invoiced, awaiting payment). This deliberately reverses the
    // Repair 11 choice (billed + to_bill under "לגבייה") per Oren, so the
    // dashboard and the report never disagree.
    const notBilled = billingEvents.filter((ev) => ev.status === 'pending' || ev.status === 'to_bill')
    const awaiting = billingEvents.filter((ev) => ev.status === 'billed')
    const notBilledCount = notBilled.length
    const notBilledSum = sumEventInvoice(notBilled)
    const awaitingPaymentSum = sumEventInvoice(awaiting)
    const awaitingPaymentCount = awaiting.length
    // Receipts = money actually received = paid events only, by payment_date
    // (never due_date — that only feeds the forecast widget above).
    // תקבולים = סכום חשבונית of paid events by payment_date (via finance.ts).
    const collectedYTD = sumEventInvoice(paidEventsInRange(billingEvents, `${curYear}-01-01`, `${curYear}-12-31`))
    const collectedThisMonth = sumEventInvoice(paidEventsInRange(billingEvents, `${curMonthKey}-01`, `${curMonthKey}-31`))
    return { notBilledCount, notBilledSum, awaitingPaymentSum, awaitingPaymentCount, collectedThisMonth, collectedYTD }
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
      title: 'טרם חויב',
      value: NUM.format(stats.notBilledCount),
      icon: <FileText size={20} className="text-amber-600" />,
      iconBg: 'bg-amber-50',
      sub: ILS.format(stats.notBilledSum),
    },
    {
      title: 'ממתין לתשלום',
      value: ILS.format(stats.awaitingPaymentSum),
      icon: <Clock size={20} className="text-purple-600" />,
      iconBg: 'bg-purple-50',
      sub: `${NUM.format(stats.awaitingPaymentCount)} חיובים`,
      // No money disappears from view: the still-unbilled figure stays
      // visible as a smaller line under this card (Repair 17, §3.6).
      sub2: `טרם חויב: ${ILS.format(stats.notBilledSum)}`,
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

      <PendingApprovalsCard />

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
              {'sub2' in card && card.sub2 && (
                <p className="mt-0.5 text-[11px] text-muted-foreground/80">{card.sub2}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <YtdKpiRow />

      <ExpectedPaymentSchedule />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">הכנסה חודשית – 12 חודשים אחרונים</CardTitle>
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

      <ServiceTypeBreakdown />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">הכנסה לפי מוביל שירות – מתחילת השנה</CardTitle>
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
                <YAxis type="category" dataKey="axisLabel" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={150} />
                <Tooltip content={<LeadTooltip />} />
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

      {/* Repair 16: BonusWidget existed but was never mounted anywhere in the
          app — wired in here, next to the per-employee revenue breakdown it
          complements, since the repair's own QA checklist treated it as an
          existing dashboard surface. */}
      <BonusWidget />

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
                <TableHead className="text-right px-4">תאריך חיוב מתוכנן</TableHead>
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
