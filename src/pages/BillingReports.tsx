import { Fragment, useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DateInput } from '@/components/ui/date-input'
import { useQuery } from '@tanstack/react-query'
import { FileText, FileDown, Receipt, Search, X, Filter } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { generatePerformaPDF } from '@/lib/pdf'
import { HOURS_SERVICE_NAME } from '@/lib/hoursService'
import { BILL_BUCKETS } from '@/lib/billingBuckets'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { jerusalemYearMonth, toAgorot, fromAgorot, ungeneratedRemainderAgorot } from '@/lib/finance'
import {
  buildBillingEventPatch,
  isDueToInvoice,
  isOverduePayment,
  type EditableBillingField,
} from '@/lib/billingEvents'
import type {
  BillingEvent,
  BillingEventStatus,
  Transaction,
} from '@/lib/types'
import type { ServiceType } from '@/lib/serviceTypes'
import ClientPicker from '@/components/ClientPicker'
import CollectionForecastDialog from '@/components/CollectionForecastDialog'
import TransactionDialog from '@/components/TransactionDialog'
import { DateCell, DueDateCell } from '@/components/ui/date-cell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  SortableHead,
  toggleSortKey,
  compareBySort,
  type SortState,
} from '@/components/SortableHead'

type EventWithTxn = BillingEvent & {
  transactions: Pick<
    Transaction,
    'client_name' | 'client_id' | 'service_type' | 'service_type_id' | 'needs_approval' | 'approved_at'
  >
}

// Repair 29: a deal with a positive net_invoice_amount − Σ non-cancelled events
// has money that was contracted but never got a billing event. It shows as one
// virtual "טרם חויב" row (not an event: not selectable, no documents).
type DealWithEvents = Transaction & { billing_events: { amount: number | string; status: string }[] }
type RemainderRow = { id: string; deal: DealWithEvents; amountAgorot: number; description: string }
type Row = { kind: 'event'; event: EventWithTxn } | { kind: 'remainder'; remainder: RemainderRow }

const STATUS_LABEL: Record<BillingEventStatus, string> = {
  pending: 'ממתין',
  to_bill: 'לחיוב',
  billed: 'חויב',
  paid: 'שולם',
  cancelled: 'מבוטל',
}
// Green/emerald = paid (money received) only. billed = amber (awaiting
// payment); pending/to_bill = gray (not yet actionable).
const STATUS_BADGE: Record<BillingEventStatus, string> = {
  pending: 'bg-gray-50 text-gray-700 border-gray-200',
  to_bill: 'bg-gray-50 text-gray-700 border-gray-200',
  billed: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
}

type DateFilterColumn = 'billing_date' | 'invoice_date' | 'due_date' | 'payment_date'
const DATE_FILTER_LABEL: Record<DateFilterColumn, string> = {
  billing_date: 'תאריך חיוב מתוכנן',
  invoice_date: 'תאריך הפקה',
  due_date: 'תאריך תשלום צפוי',
  payment_date: 'תאריך תשלום',
}

const formatCurrency = (n: number | null | undefined) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n)
}

// Repair 29 column-fit: compact cells so all 12 columns fit at 1440px (content
// ≈ 1136px beside the w-64 sidebar). Below that the table scrolls inside its card;
// the checkbox + לקוח columns are sticky on the right (RTL) with opaque backgrounds.
const CELL = 'px-1.5 py-1.5 align-middle'
// Headers wrap to two lines (text unchanged, only wrapped), bottom-aligned, right-aligned.
const HEAD = 'px-1.5 whitespace-normal leading-tight h-auto py-2 align-bottom text-right'
// Column widths: dates sized to dd/MM/yy or a dd/MM/yyyy input, document numbers to ~8 digits;
// the space freed goes to לקוח.
const W_DATE = 'w-[4.75rem] min-w-[4.75rem] max-w-[4.75rem]'
const W_DATE_INPUT = 'w-[7.5rem] min-w-[7.5rem]'
const W_DOC = 'w-[5.75rem] min-w-[5.75rem] max-w-[5.75rem]'
const STICKY_CHK = 'sticky right-0 z-10 w-8 min-w-8'
const STICKY_CLIENT = 'sticky right-8 z-10 w-36 min-w-36 max-w-36'
const stickyBg = (selected: boolean) => (selected ? 'bg-purple-50' : 'bg-background group-hover:bg-purple-50')

export default function BillingReports() {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = (k: string) => searchParams.get(k) ?? ''
  const setParam = (k: string, v: string | null) =>
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev)
      if (v == null || v === '') n.delete(k); else n.set(k, v)
      return n
    }, { replace: true })
  const clientId = param('client') || null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const billBuckets = useMemo(() => new Set(param('bill').split(',').filter(Boolean)), [searchParams])
  const toggleBucket = (b: string) => {
    const n = new Set(billBuckets)
    if (n.has(b)) n.delete(b); else n.add(b)
    setParam('bill', Array.from(n).join(','))
  }
  const [dateFilterColumn, setDateFilterColumn] = useState<DateFilterColumn>('due_date')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [serviceTypeFilter, setServiceTypeFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>({ key: 'due_date', dir: 'desc' })
  const [forecastOpen, setForecastOpen] = useState(false)
  const [openDeal, setOpenDeal] = useState<DealWithEvents | null>(null)
  const toggleSort = (key: string) => setSort((prev) => toggleSortKey(prev, key))

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: serviceTypes = [] } = useQuery<ServiceType[]>({
    queryKey: ['service_types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_types').select('*').order('display_order', { ascending: true })
      if (error) throw error
      return data as ServiceType[]
    },
  })

  // The status condition lives client-side (BILL_BUCKETS, shared with
  // Transactions); the server only skips cancelled events unless מבוטל is selected.
  const includeCancelled = billBuckets.has('cancelled')
  const { data: rawEvents = [], refetch, isLoading: eventsLoading, isError: eventsError } = useQuery<EventWithTxn[]>({
    queryKey: ['billing_events_dashboard', clientId, includeCancelled, dateFilterColumn, dateFrom, dateTo, serviceTypeFilter],
    queryFn: async () => {
      let q = supabase
        .from('billing_events')
        .select('*, transactions!inner(client_name, client_id, service_type, service_type_id, needs_approval, approved_at)')
        .order('billing_date', { ascending: true })
      if (clientId) q = q.eq('transactions.client_id', clientId)
      if (!includeCancelled) q = q.neq('status', 'cancelled')
      if (dateFrom) q = q.gte(dateFilterColumn, dateFrom)
      if (dateTo) q = q.lte(dateFilterColumn, dateTo)
      if (serviceTypeFilter !== 'all') q = q.eq('transactions.service_type', serviceTypeFilter)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as EventWithTxn[]
    },
  })

  // Deals + their events, for the ungenerated-remainder virtual rows.
  const { data: deals = [], refetch: refetchDeals, isLoading: dealsLoading, isError: dealsError } = useQuery<DealWithEvents[]>({
    queryKey: ['billing_reports_deals', clientId, serviceTypeFilter],
    queryFn: async () => {
      let q = supabase.from('transactions').select('*, billing_events(amount, status)')
      if (clientId) q = q.eq('client_id', clientId)
      if (serviceTypeFilter !== 'all') q = q.eq('service_type', serviceTypeFilter)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as DealWithEvents[]
    },
  })

  const today = jerusalemYearMonth().today
  const dateRangeActive = !!(dateFrom || dateTo)

  const eventRows = useMemo(() => {
    const byBucket = (e: EventWithTxn) =>
      billBuckets.size === 0
        ? e.status !== 'cancelled'
        : BILL_BUCKETS.some((b) => billBuckets.has(b.key) && b.match(e, today))
    const rows = rawEvents.filter(byBucket)
    if (!searchDebounced) return rows
    return rows.filter((e) => {
      const haystack = [
        e.transactions.client_name,
        e.description,
        e.invoice_number,
        e.receipt_number,
        e.transactions.service_type,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
      return haystack.some((s) => s.includes(searchDebounced))
    })
  }, [rawEvents, billBuckets, today, searchDebounced])

  const remainderRows = useMemo<RemainderRow[]>(() => {
    // A virtual row has no dates, so it can never satisfy a date-range filter,
    // and it only belongs to the טרם חויב bucket.
    if (dateRangeActive) return []
    if (billBuckets.size > 0 && !billBuckets.has('not_billed')) return []
    const rows: RemainderRow[] = []
    for (const d of deals) {
      const amountAgorot = ungeneratedRemainderAgorot(d, d.billing_events ?? [])
      if (amountAgorot <= 0) continue
      const what = [d.position_name, d.candidate_name].filter(Boolean).join(' · ')
      const period = d.period_start ? formatDate(d.period_start) + (d.period_end ? '–' + formatDate(d.period_end) : '') : ''
      const description = ['יתרה שטרם נוצר לה חיוב', what || period].filter(Boolean).join(' · ')
      rows.push({ id: 'rem:' + d.id, deal: d, amountAgorot, description })
    }
    if (!searchDebounced) return rows
    return rows.filter((r) =>
      [r.deal.client_name, r.description, r.deal.service_type]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(searchDebounced)),
    )
  }, [deals, dateRangeActive, billBuckets, searchDebounced])

  const getRowSortValue = (r: Row, key: string): unknown => {
    if (r.kind === 'remainder') {
      switch (key) {
        case 'client_name': return r.remainder.deal.client_name
        case 'amount': return fromAgorot(r.remainder.amountAgorot)
        case 'description': return r.remainder.description
        case 'status': return 'pending'
        default: return null // every date sorts last
      }
    }
    const e = r.event
    switch (key) {
      case 'client_name': return e.transactions.client_name
      case 'amount': return Number(e.amount)
      default: return (e as Record<string, unknown>)[key] // description, billing_date, invoice_date, due_date, payment_date, status
    }
  }

  const sortedRows = useMemo(() => {
    const arr: Row[] = [
      ...eventRows.map((event): Row => ({ kind: 'event', event })),
      ...remainderRows.map((remainder): Row => ({ kind: 'remainder', remainder })),
    ]
    arr.sort((a, b) => compareBySort(a, b, sort, getRowSortValue))
    return arr
  }, [eventRows, remainderRows, sort])

  // Selection (client export) covers approved events only — never virtual rows,
  // never events of a deal still awaiting approval.
  const selectableEvents = useMemo(
    () => eventRows.filter((e) => !e.transactions.needs_approval || !!e.transactions.approved_at),
    [eventRows],
  )
  const selectedEvents = useMemo(
    () => selectableEvents.filter((e) => selectedIds.has(e.id)),
    [selectableEvents, selectedIds],
  )
  const uniqueClients = useMemo(
    () => new Set(selectedEvents.map((e) => e.transactions.client_name ?? '')).size,
    [selectedEvents],
  )

  const allVisibleSelected =
    selectableEvents.length > 0 && selectableEvents.every((e) => selectedIds.has(e.id))

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableEvents.map((e) => e.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExportPerforma = () => {
    if (selectedEvents.length === 0 || uniqueClients !== 1) return
    const clientName = selectedEvents[0]?.transactions.client_name ?? 'לקוח'
    generatePerformaPDF(
      selectedEvents.map((ev) => ({
        description: ev.description,
        billing_date: ev.billing_date,
        amount: Number(ev.amount) || 0,
      })),
      clientName,
    )
  }

  // Totals — three buckets that sum to the screen (§3.4), from the currently
  // visible rows, in integer agorot. Virtual remainder rows are טרם חויב, so
  // טרם חויב + ממתין לתשלום + שולם = סה"כ holds for whatever is visible.
  const totals = useMemo(() => {
    let notBilled = 0, awaitingNotYetDue = 0, awaitingOverdue = 0, paid = 0
    for (const e of eventRows) {
      const amount = toAgorot(e.amount)
      if (e.status === 'pending' || e.status === 'to_bill') notBilled += amount
      else if (e.status === 'billed') {
        if (isOverduePayment(e, today)) awaitingOverdue += amount
        else awaitingNotYetDue += amount
      } else if (e.status === 'paid') paid += amount
    }
    for (const r of remainderRows) notBilled += r.amountAgorot
    const awaitingPayment = awaitingNotYetDue + awaitingOverdue
    return {
      notBilled: fromAgorot(notBilled),
      awaitingPayment: fromAgorot(awaitingPayment),
      awaitingNotYetDue: fromAgorot(awaitingNotYetDue),
      awaitingOverdue: fromAgorot(awaitingOverdue),
      paid: fromAgorot(paid),
      total: fromAgorot(notBilled + awaitingPayment + paid),
    }
  }, [eventRows, remainderRows, today])

  const rowCount = sortedRows.length
  const loading = eventsLoading || dealsLoading
  const failed = eventsError || dealsError

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-purple-900">דוחות חיוב</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => setForecastOpen(true)}
          className="border-purple-300 text-purple-700 hover:bg-purple-50"
        >
          <Receipt className="w-4 h-4 ml-1" />
          דוח צפי גבייה
        </Button>
      </div>

      {/* overflow-visible: Card clips its children (overflow-hidden), which cut the
          client picker's dropdown down to an empty sliver (Repair 29). */}
      <Card className="p-4 overflow-visible">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search — takes all remaining space */}
          <div className="relative flex-1 min-w-52">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="חפש בתיאור / חשבונית / קבלה / לקוח..."
              className="border-purple-200 focus-visible:ring-purple-400 pr-9 pl-9"
              dir="rtl"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
                aria-label="נקה"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Client picker */}
          <div className="w-56 shrink-0" data-testid="client-filter">
            <ClientPicker
              value={clientId}
              onChange={(id) => setParam('client', id)}
              allSentinelLabel="כל הלקוחות"
              placeholder="כל הלקוחות"
              popoverClassName="min-w-[16rem] max-h-72"
              compact
            />
          </div>

          {/* Date filter column selector */}
          <Select value={dateFilterColumn} onValueChange={(v) => setDateFilterColumn((v as DateFilterColumn) ?? 'due_date')}>
            <SelectTrigger className="w-36 shrink-0">
              <span className="text-sm truncate">סנן לפי: {DATE_FILTER_LABEL[dateFilterColumn]}</span>
            </SelectTrigger>
            <SelectContent>
              {(['billing_date', 'invoice_date', 'due_date', 'payment_date'] as DateFilterColumn[]).map((col) => (
                <SelectItem key={col} value={col}>{DATE_FILTER_LABEL[col]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* From date */}
          <DateInput
            className="w-36 shrink-0"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="מתאריך"
          />

          {/* To date */}
          <DateInput
            className="w-36 shrink-0"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="עד תאריך"
          />

          {/* Service type */}
          <Select value={serviceTypeFilter} onValueChange={(v) => setServiceTypeFilter(v ?? 'all')}>
            <SelectTrigger className="w-32 shrink-0">
              <span className="text-sm truncate">
                {serviceTypeFilter === 'all' ? 'סוג שירות' : serviceTypeFilter}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכל</SelectItem>
              {serviceTypes.map((st) => (<SelectItem key={st.id} value={st.name}>{st.name}</SelectItem>))}
              {/* The hours service is a real service_types row since Repair 25; this
                  fallback only shows if it has not been seeded yet. The filter matches
                  transactions.service_type by NAME, so the constant is the value. */}
              {!serviceTypes.some((st) => st.name === HOURS_SERVICE_NAME) && (
                <SelectItem value={HOURS_SERVICE_NAME}>{HOURS_SERVICE_NAME}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <span className="text-sm text-purple-800 font-medium">
            {selectedIds.size} פריטים נבחרו
          </span>
          <Button
            size="sm"
            disabled={uniqueClients > 1 || uniqueClients === 0}
            onClick={handleExportPerforma}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            title={uniqueClients > 1 ? 'ניתן לייצא ללקוח אחד בלבד' : ''}
          >
            <FileDown className="w-4 h-4 ml-1" />
            הפק חשבון עסקה
          </Button>
          {uniqueClients > 1 && (
            <span className="text-xs text-amber-700">ניתן לייצא ללקוח אחד בלבד</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            נקה בחירה
          </Button>
        </div>
      )}

      <Card>
        {failed ? (
          <div className="p-8 text-center text-destructive" data-testid="billing-error">שגיאה בטעינת החיובים</div>
        ) : loading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : rowCount === 0 ? (
          <div className="p-8 text-center text-muted-foreground">אין חיובים להצגה</div>
        ) : (
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-purple-50">
                <TableHead className={cn(HEAD, 'text-center', STICKY_CHK, 'bg-purple-50')}>
                  <input
                    type="checkbox"
                    aria-label="בחר הכל"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                  />
                </TableHead>
                <SortableHead col="client_name" label="לקוח" sort={sort} onToggle={toggleSort} className={cn(HEAD, STICKY_CLIENT, 'bg-purple-50')} />
                <TableHead className={cn(HEAD, 'text-purple-800')}>שירות</TableHead>
                <SortableHead col="description" label="תיאור" sort={sort} onToggle={toggleSort} className={HEAD} />
                <SortableHead col="amount" label="סכום" sort={sort} onToggle={toggleSort} className={HEAD} />
                <TableHead className={cn(HEAD, 'text-right text-purple-800 font-semibold')}>
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 cursor-pointer select-none hover:text-purple-600"
                      onClick={() => toggleSort('status')}
                      data-testid="status-sort"
                    >
                      סטטוס
                      <span className="text-[10px] text-muted-foreground">
                        {sort.key === 'status' ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                    <Popover>
                      <PopoverTrigger
                        className="inline-flex items-center gap-1 hover:text-purple-600"
                        data-testid="status-filter-trigger"
                        aria-label="סינון לפי סטטוס"
                      >
                        <Filter className={cn('h-3.5 w-3.5', billBuckets.size > 0 && 'fill-purple-600 text-purple-600')} />
                        {billBuckets.size > 0 && (
                          <span className="rounded-full bg-purple-600 px-1.5 text-[10px] leading-4 text-white">{billBuckets.size}</span>
                        )}
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56" dir="rtl">
                        {BILL_BUCKETS.map((b) => (
                          <label key={b.key} className="flex items-center gap-2 text-sm cursor-pointer font-normal">
                            <Checkbox checked={billBuckets.has(b.key)} onCheckedChange={() => toggleBucket(b.key)} data-testid={`status-${b.key}`} />
                            {b.label}
                          </label>
                        ))}
                        <Button size="sm" variant="outline" disabled={billBuckets.size === 0} onClick={() => setParam('bill', null)}>נקה</Button>
                      </PopoverContent>
                    </Popover>
                  </span>
                </TableHead>
                <SortableHead col="billing_date" label="תאריך חיוב מתוכנן" sort={sort} onToggle={toggleSort} className={cn(HEAD, W_DATE)} />
                <TableHead className={cn(HEAD, 'text-purple-800', W_DOC)}>מספר חשבון עסקה</TableHead>
                <SortableHead col="invoice_date" label="תאריך הפקה" sort={sort} onToggle={toggleSort} className={cn(HEAD, W_DATE_INPUT)} />
                <SortableHead col="due_date" label="תאריך תשלום צפוי" sort={sort} onToggle={toggleSort} className={cn(HEAD, W_DATE)} />
                <TableHead className={cn(HEAD, 'text-purple-800', W_DOC)}>מספר חשבונית מס קבלה</TableHead>
                <SortableHead col="payment_date" label="תאריך תשלום" sort={sort} onToggle={toggleSort} className={cn(HEAD, W_DATE_INPUT)} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r) =>
                r.kind === 'event' ? (
                  <BillingEventDashRow
                    key={r.event.id}
                    event={r.event}
                    today={today}
                    onChanged={() => refetch()}
                    selected={selectedIds.has(r.event.id)}
                    onToggleSelect={() => toggleSelect(r.event.id)}
                  />
                ) : (
                  <RemainderDashRow
                    key={r.remainder.id}
                    row={r.remainder}
                    onOpen={() => setOpenDeal(r.remainder.deal)}
                  />
                ),
              )}
            </TableBody>
          </Table>
        )}

        {!failed && !loading && rowCount > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-4 px-4 py-3 border-t bg-purple-50/40 text-sm">
            <div className="flex items-center gap-4">
              <span className="text-gray-600">טרם חויב:</span>
              <span className="font-semibold text-gray-700" data-testid="total-not-billed">{formatCurrency(totals.notBilled)}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-amber-700">ממתין לתשלום:</span>
              <span className="font-semibold text-amber-700">
                {formatCurrency(totals.awaitingPayment)}
                <span className="font-normal text-xs text-muted-foreground mr-1">
                  (בפירעון {formatCurrency(totals.awaitingNotYetDue)} · <span className="text-red-600">באיחור {formatCurrency(totals.awaitingOverdue)}</span>)
                </span>
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-emerald-700">שולם:</span>
              <span className="font-semibold text-emerald-700">{formatCurrency(totals.paid)}</span>
            </div>
            <div className="flex items-center gap-4 border-r pr-4">
              <span className="text-muted-foreground">סה&quot;כ:</span>
              <span className="font-bold" data-testid="total-all">{formatCurrency(totals.total)}</span>
            </div>
          </div>
        )}
      </Card>

      <CollectionForecastDialog open={forecastOpen} onOpenChange={setForecastOpen} />

      {/* Opens a deal from a virtual remainder row — events are generated there. */}
      <TransactionDialog
        open={!!openDeal}
        onOpenChange={(o) => {
          if (!o) {
            setOpenDeal(null)
            void refetch()
            void refetchDeals()
          }
        }}
        editing={openDeal}
      />
    </div>
  )
}

function RemainderDashRow({ row, onOpen }: { row: RemainderRow; onOpen: () => void }) {
  const { deal } = row
  const unapproved = deal.needs_approval && !deal.approved_at
  return (
    <TableRow
      className="group cursor-pointer hover:bg-purple-50/30"
      onClick={onOpen}
      data-testid="remainder-row"
      title="פתח את העסקה — שם ניתן להפיק את החיובים"
    >
      <TableCell className={cn(CELL, STICKY_CHK, stickyBg(false))} />
      <TableCell className={cn(CELL, 'font-medium', STICKY_CLIENT, stickyBg(false))}>
        <div className="line-clamp-2 break-words whitespace-normal leading-tight" title={deal.client_name}>{deal.client_name}</div>
      </TableCell>
      <TableCell className={cn(CELL, 'min-w-24 max-w-[6.5rem] whitespace-normal leading-tight')}>{deal.service_type || '—'}</TableCell>
      <TableCell className={cn(CELL, 'text-xs min-w-28 max-w-40 whitespace-normal leading-tight')}>
        <div className="line-clamp-2" title={row.description}>{row.description}</div>
      </TableCell>
      <TableCell className={cn(CELL, 'whitespace-nowrap')}>{formatCurrency(fromAgorot(row.amountAgorot))}</TableCell>
      <TableCell className={CELL}>
        <Badge variant="outline" className={`${STATUS_BADGE.pending} text-xs whitespace-nowrap`}>טרם חויב</Badge>
        {unapproved && (
          <Badge variant="outline" className="mt-1 bg-amber-50 text-amber-700 border-amber-200 text-[10px] whitespace-nowrap">ממתין לאישור</Badge>
        )}
      </TableCell>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableCell key={i} className={cn(CELL, 'text-muted-foreground')}>—</TableCell>
      ))}
    </TableRow>
  )
}

function BillingEventDashRow({
  event,
  today,
  onChanged,
  selected,
  onToggleSelect,
}: {
  event: EventWithTxn
  today: string
  onChanged: () => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const [invoice, setInvoice] = useState(event.invoice_number ?? '')
  const [invoiceDate, setInvoiceDate] = useState(event.invoice_date ?? '')
  const [paymentDate, setPaymentDate] = useState(event.payment_date ?? '')
  const [receipt, setReceipt] = useState(event.receipt_number ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  useEffect(() => {
    setInvoice(event.invoice_number ?? '')
    setInvoiceDate(event.invoice_date ?? '')
    setPaymentDate(event.payment_date ?? '')
    setReceipt(event.receipt_number ?? '')
  }, [event.id, event.invoice_number, event.invoice_date, event.payment_date, event.receipt_number])

  const transactionApproved = !event.transactions.needs_approval || !!event.transactions.approved_at
  const awaitingApprovalTitle = transactionApproved ? undefined : 'העסקה ממתינה לאישור — לא ניתן להפיק מסמכים'

  // Repair 17: the ONLY status-computation + document-pairing logic lives in
  // buildBillingEventPatch — never set status or a paired date/number here.
  const saveField = async (field: EditableBillingField, value: string) => {
    setBusy(field)
    setRowError(null)
    const patch = buildBillingEventPatch(event, field, value, transactionApproved)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error } = await supabase.from('billing_events').update(patch).eq('id', event.id).abortSignal(controller.signal)
      if (error) throw error
      onChanged()
    } catch (err) {
      console.error('BillingEventDashRow save error:', err)
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setRowError(isTimeout ? 'פג זמן — נסה שנית' : 'שגיאה בשמירה')
    } finally {
      clearTimeout(timer)
      setBusy(null)
    }
  }

  const dueRed = isOverduePayment(event, today)
  const billingRed = isDueToInvoice(event, today)

  return (
    <Fragment>
    <TableRow className={`group hover:bg-purple-50/30 ${selected ? 'bg-purple-50/40' : ''}`}>
      <TableCell className={cn(CELL, 'text-center', STICKY_CHK, stickyBg(selected))}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={!transactionApproved}
          title={awaitingApprovalTitle}
          aria-label="בחר חיוב"
        />
      </TableCell>
      <TableCell className={cn(CELL, 'font-medium', STICKY_CLIENT, stickyBg(selected))}>
        <div className="line-clamp-2 break-words whitespace-normal leading-tight" title={event.transactions.client_name}>{event.transactions.client_name}</div>
      </TableCell>
      <TableCell className={cn(CELL, 'min-w-24 max-w-[6.5rem] whitespace-normal leading-tight')}>{event.transactions.service_type ?? '—'}</TableCell>
      <TableCell className={cn(CELL, 'text-xs min-w-28 max-w-40 whitespace-normal leading-tight')}>
        <div className="line-clamp-2" title={event.description ?? undefined}>{event.description ?? '—'}</div>
      </TableCell>
      <TableCell className={cn(CELL, 'whitespace-nowrap')}>{formatCurrency(event.amount)}</TableCell>
      <TableCell className={CELL}>
        <Badge variant="outline" className={`${STATUS_BADGE[event.status]} text-xs whitespace-nowrap`}>
          {STATUS_LABEL[event.status]}
        </Badge>
        {!transactionApproved && (
          <Badge variant="outline" className="mt-1 bg-amber-50 text-amber-700 border-amber-200 text-[10px] whitespace-nowrap">ממתין לאישור</Badge>
        )}
      </TableCell>
      <TableCell className={cn(CELL, billingRed ? 'text-red-600 font-medium' : '')}>
        <DateCell value={event.billing_date} />
      </TableCell>
      <TableCell className={CELL}>
        <Input
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          onBlur={() => invoice !== (event.invoice_number ?? '') && void saveField('invoice_number', invoice)}
          className="h-7 w-[4.5rem] px-1.5 text-xs"
          disabled={!transactionApproved}
          title={awaitingApprovalTitle}
          placeholder={busy === 'invoice_number' ? 'שומר...' : ''}
        />
      </TableCell>
      <TableCell className={CELL}>
        <DateInput
          value={invoiceDate}
          onChange={(e) => setInvoiceDate(e.target.value)}
          onBlur={() => invoiceDate !== (event.invoice_date ?? '') && void saveField('invoice_date', invoiceDate)}
          className="h-7 w-[7rem] min-w-0 px-1 text-xs"
          disabled={!transactionApproved}
          title={awaitingApprovalTitle}
        />
      </TableCell>
      <TableCell className={cn(CELL, dueRed ? 'text-red-600 font-medium' : '')}>
        <DueDateCell
          dueDate={event.due_date}
          isManual={event.due_date_is_manual}
          hasBasis={!!event.invoice_date}
        />
      </TableCell>
      <TableCell className={CELL}>
        <Input
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
          onBlur={() => receipt !== (event.receipt_number ?? '') && void saveField('receipt_number', receipt)}
          className="h-7 w-[4.5rem] px-1.5 text-xs"
          disabled={!transactionApproved}
          title={awaitingApprovalTitle}
          placeholder={busy === 'receipt_number' ? 'שומר...' : ''}
        />
      </TableCell>
      <TableCell className={CELL}>
        <DateInput
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          onBlur={() => paymentDate !== (event.payment_date ?? '') && void saveField('payment_date', paymentDate)}
          className="h-7 w-[7rem] min-w-0 px-1 text-xs"
          disabled={!transactionApproved || !event.receipt_number}
          title={awaitingApprovalTitle ?? (!event.receipt_number ? 'יש להזין מספר חשבונית מס קבלה תחילה' : undefined)}
        />
      </TableCell>
    </TableRow>
    {rowError && (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={12} className="py-1 text-[11px] text-destructive text-left" dir="rtl">
          {rowError}
        </TableCell>
      </TableRow>
    )}
    </Fragment>
  )
}
