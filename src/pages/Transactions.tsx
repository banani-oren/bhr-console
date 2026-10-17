import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Pencil, Trash2, Search, X, Check, Filter } from 'lucide-react'
import { DateCell } from '@/components/ui/date-cell'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTable } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { toAgorot, txInvoiceAgorot, txSupplierAgorot, txIncomeAgorot, txSupplierAmount, txIncome, jerusalemYearMonth } from '@/lib/finance'
import { isOverduePayment } from '@/lib/billingEvents'
import { normalizeLead } from '@/lib/bonus'
import type {
  BillingEvent,
  BillingEventStatus,
  Transaction,
} from '@/lib/types'
import type { ServiceType } from '@/lib/serviceTypes'
import TransactionDialog from '@/components/TransactionDialog'
import DeleteTransactionDialog from '@/components/DeleteTransactionDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  SortableHead,
  toggleSortKey,
  compareBySort,
  type SortState,
} from '@/components/SortableHead'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const formatCurrency = (n: number | null | undefined) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n)
}

// Green ALWAYS means "paid" (money received). billed = amber (invoiced,
// awaiting payment); pending = gray (not yet actionable).
const STATUS_COLOR: Record<BillingEventStatus, string> = {
  pending:   'bg-gray-400',
  to_bill:   'bg-blue-500',
  billed:    'bg-amber-400',
  paid:      'bg-emerald-600',
  cancelled: 'bg-red-400',
}

function BillingDots({ events }: { events: BillingEvent[] }) {
  if (events.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <div className="flex gap-1 items-center">
      {events.map((e) => (
        <span
          key={e.id}
          title={`${e.description ?? ''} · ${e.billing_date ?? ''} · ${e.status}`}
          className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_COLOR[e.status]}`}
        />
      ))}
    </div>
  )
}

export default function Transactions() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const { data: transactions = [], isLoading } = useTable<Transaction>('transactions', {
    orderBy: 'created_at',
    ascending: false,
  })

  const { data: serviceTypes = [] } = useQuery<ServiceType[]>({
    queryKey: ['service_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_types')
        .select('*')
        .order('display_order', { ascending: true })
      if (error) throw error
      return data as ServiceType[]
    },
  })

  const { data: allBillingEvents = [] } = useQuery<BillingEvent[]>({
    queryKey: ['billing_events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_events')
        .select('*')
        .order('event_index', { ascending: true })
      if (error) throw error
      return data as BillingEvent[]
    },
  })

  const eventsByTxn = useMemo(() => {
    const m = new Map<string, BillingEvent[]>()
    for (const e of allBillingEvents) {
      const arr = m.get(e.transaction_id) ?? []
      arr.push(e)
      m.set(e.transaction_id, arr)
    }
    return m
  }, [allBillingEvents])

  const approveMut = useMutation({
    mutationFn: async (txnId: string) => {
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
        // Move pending events whose billing_date has passed to to_bill.
        const today = new Date().toISOString().slice(0, 10)
        await supabase
          .from('billing_events')
          .update({ status: 'to_bill' })
          .eq('transaction_id', txnId)
          .eq('status', 'pending')
          .lte('billing_date', today)
          .abortSignal(controller.signal)
      } finally {
        clearTimeout(timer)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['billing_events'] })
    },
  })

  // Search + sort
  // All filters live in the URL query string (Repair 26): a refresh or a shared
  // link keeps the view. No localStorage.
  const [searchParams, setSearchParams] = useSearchParams()
  const param = (k: string, d = '') => searchParams.get(k) ?? d
  const setParam = (k: string, v: string | null) =>
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev)
      if (v == null || v === '' || v === 'all') n.delete(k); else n.set(k, v)
      return n
    }, { replace: true })
  const filterClosingMonth = param('month', 'all')
  const filterClosingYear = param('year', 'all')
  const filterLead = param('lead', 'all')
  const filterService = param('svc', 'all')
  const payMode: 'due' | 'paid' = param('pm', 'due') === 'paid' ? 'paid' : 'due'
  const payFrom = param('from')
  const payTo = param('to')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const billBuckets = useMemo(() => new Set(param('bill').split(',').filter(Boolean)), [searchParams])
  const toggleBucket = (b: string) => {
    const n = new Set(billBuckets)
    if (n.has(b)) n.delete(b); else n.add(b)
    setParam('bill', Array.from(n).join(','))
  }
  const [searchInput, setSearchInput] = useState(param('q'))
  const searchDebounced = param('q').trim().toLowerCase()
  const [sort, setSort] = useState<SortState>({ key: 'close_date', dir: 'desc' })
  const toggleSort = (key: string) => setSort((prev) => toggleSortKey(prev, key))

  useEffect(() => {
    const t = setTimeout(() => setParam('q', searchInput.trim()), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const serviceNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of serviceTypes) m.set(s.id, s.name)
    return m
  }, [serviceTypes])

  const resolveServiceName = (t: Transaction) =>
    (t.service_type_id && serviceNameById.get(t.service_type_id)) || t.service_type || ''

  const searchMatches = (t: Transaction, q: string): boolean => {
    if (!q) return true
    const cf = (t.custom_fields ?? {}) as Record<string, unknown>
    const needles = [
      t.client_name,
      t.service_lead,
      t.position_name,
      t.candidate_name,
      cf.position_name,
      cf.candidate_name,
      cf.position_number,
      t.notes,
      t.invoice_number,
      resolveServiceName(t),
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase())
    return needles.some((s) => s.includes(q))
  }

  const today = jerusalemYearMonth().today
  const showLeadFilter = profile?.role === 'admin' || profile?.role === 'administration'

  // Billing-status buckets (Repair 26) — same semantics as the collection model:
  // an event matches a bucket by its stored status; באיחור = invoiced, due_date
  // passed, unpaid (isOverduePayment, the dashboard's פיגור rule).
  const BILL_BUCKETS: { key: string; label: string; match: (e: BillingEvent) => boolean }[] = [
    { key: 'not_billed', label: 'טרם חויב', match: (e) => e.status === 'pending' || e.status === 'to_bill' },
    { key: 'to_bill', label: 'לחיוב עכשיו', match: (e) => e.status === 'to_bill' },
    { key: 'awaiting', label: 'ממתין לתשלום', match: (e) => e.status === 'billed' },
    { key: 'overdue', label: 'באיחור', match: (e) => isOverduePayment(e, today) && !e.payment_date },
    { key: 'paid', label: 'שולם', match: (e) => e.status === 'paid' },
    { key: 'cancelled', label: 'מבוטל', match: (e) => e.status === 'cancelled' },
  ]
  const billMatches = (evs: BillingEvent[]) => {
    if (billBuckets.size === 0) return true
    if (evs.length === 0) return billBuckets.has('none')
    return BILL_BUCKETS.some((b) => billBuckets.has(b.key) && evs.some(b.match))
  }

  // Distinct leads (normalised), displayed with the first-seen spelling.
  const leadOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of transactions) {
      const k = normalizeLead(t.service_lead)
      if (k && !m.has(k)) m.set(k, (t.service_lead ?? '').trim())
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'he'))
  }, [transactions])

  const payRangeActive = !!(payFrom || payTo)
  const anyFilterActive =
    !!searchDebounced || filterClosingYear !== 'all' || filterClosingMonth !== 'all' ||
    filterLead !== 'all' || filterService !== 'all' || billBuckets.size > 0 || payRangeActive

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (!searchMatches(t, searchDebounced)) return false
      if (filterClosingYear !== 'all' && t.closing_year !== Number(filterClosingYear)) return false
      if (filterClosingMonth !== 'all' && t.closing_month !== Number(filterClosingMonth)) return false
      if (filterLead !== 'all' && normalizeLead(t.service_lead) !== filterLead) return false
      if (filterService !== 'all') {
        const name = resolveServiceName(t)
        if (filterService === 'none' ? name !== '' : name !== filterService) return false
      }
      const evs = eventsByTxn.get(t.id) ?? []
      if (!billMatches(evs)) return false
      if (payRangeActive) {
        const hit = evs.some((e) => {
          if (e.status === 'cancelled') return false
          const d = payMode === 'paid' ? e.payment_date : e.due_date
          return !!d && (!payFrom || d >= payFrom) && (!payTo || d <= payTo)
        })
        if (!hit) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, searchDebounced, filterClosingMonth, filterClosingYear, filterLead, filterService, billBuckets, payMode, payFrom, payTo, eventsByTxn, serviceNameById, today])

  const clearAllFilters = () => {
    setSearchInput('')
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  // שנה filter options = every distinct non-null closing_year present, descending.
  const closingYears = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.closing_year).filter((y): y is number => y != null))).sort((a, b) => b - a),
    [transactions],
  )

  const getSortValue = (t: Transaction, key: string): unknown =>
    key === 'service_type' ? resolveServiceName(t)
    : key === 'supplier_amount_calc' ? txSupplierAmount(t)
    : key === 'income_calc' ? txIncome(t)
    : (t as Record<string, unknown>)[key]

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => compareBySort(a, b, sort, getSortValue))
    return arr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, serviceNameById])

  // Totals row — derived from `sorted` (the exact rows rendered) so the footer
  // always matches what is visible. Integer agorot to avoid float drift.
  const totals = useMemo(() => {
    let invoice = 0
    let supplier = 0
    let income = 0
    let pending = 0
    let pendingCount = 0
    for (const t of sorted) {
      invoice += txInvoiceAgorot(t)
      supplier += txSupplierAgorot(t)
      income += txIncomeAgorot(t)
      if (t.needs_approval && !t.approved_at) {
        pending += txInvoiceAgorot(t)
        pendingCount += 1
      }
    }
    return {
      count: sorted.length,
      invoiceTotal: invoice / 100,
      supplierTotal: supplier / 100,
      incomeTotal: income / 100,
      pendingApprovalTotal: pending / 100,
      pendingApprovalCount: pendingCount,
    }
  }, [sorted])

  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const openAdd = () => { setEditing(null); setWizardOpen(true) }
  const openEdit = (t: Transaction) => { setEditing(t); setWizardOpen(true) }

  const [deleting, setDeleting] = useState<Transaction | null>(null)
  const handleDelete = (t: Transaction) => setDeleting(t)

  const canApprove = profile?.role === 'admin' || profile?.role === 'administration'
  // עמלת ספק is hidden from recruiters entirely (header + cell + footer).
  const showSupplier = canApprove

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-purple-900">עסקאות</h1>
        <Button
          className="bg-purple-600 hover:bg-purple-700 text-white"
          onClick={openAdd}
        >
          <Plus className="w-4 h-4 ml-2" />
          הוספת עסקה
        </Button>
      </div>

      <Card className="px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Search — takes all remaining space */}
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="חפש לפי לקוח, עובד, משרה, מועמד, מספר חשבונית..."
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

          {/* Closing year — between the search bar and the month filter */}
          <Select value={filterClosingYear} onValueChange={(v) => setParam('year', v ?? 'all')}>
            <SelectTrigger className="w-28 shrink-0 border-purple-200 focus:ring-purple-400">
              <span className="text-sm truncate">
                {filterClosingYear === 'all' ? 'שנה' : filterClosingYear}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל השנים</SelectItem>
              {closingYears.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Closing month — to the left of the year filter */}
          <Select value={filterClosingMonth} onValueChange={(v) => setParam('month', v ?? 'all')}>
            <SelectTrigger className="w-36 shrink-0 border-purple-200 focus:ring-purple-400">
              <span className="text-sm truncate">
                {filterClosingMonth === 'all'
                  ? 'חודש סגירה'
                  : HEBREW_MONTHS[Number(filterClosingMonth) - 1]}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל החודשים</SelectItem>
              {HEBREW_MONTHS.map((name, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Repair 26 — filters explicitly requested by Oren (2026-10-18); do not "restore" Repair 8. */}
          {showLeadFilter && (
            <Select value={filterLead} onValueChange={(v) => setParam('lead', v ?? 'all')}>
              <SelectTrigger className="w-36 shrink-0 border-purple-200 focus:ring-purple-400" data-testid="filter-lead">
                <span className="text-sm truncate">
                  {filterLead === 'all' ? 'מוביל' : leadOptions.find(([k]) => k === filterLead)?.[1] ?? filterLead}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל המובילים</SelectItem>
                {leadOptions.map(([k, label]) => (<SelectItem key={k} value={k}>{label}</SelectItem>))}
              </SelectContent>
            </Select>
          )}

          <Select value={filterService} onValueChange={(v) => setParam('svc', v ?? 'all')}>
            <SelectTrigger className="w-40 shrink-0 border-purple-200 focus:ring-purple-400" data-testid="filter-service">
              <span className="text-sm truncate">
                {filterService === 'all' ? 'סוג שירות' : filterService === 'none' ? 'ללא סוג שירות' : filterService}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל סוגי השירות</SelectItem>
              {serviceTypes.map((s) => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}
              <SelectItem value="none">ללא סוג שירות</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-2" data-testid="filter-row-2">
          <span className="text-sm text-muted-foreground">מועד תשלום:</span>
          <div className="inline-flex rounded-md border border-purple-200 overflow-hidden" role="group" aria-label="מועד תשלום">
            {([['due', 'צפוי'], ['paid', 'בפועל']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                data-testid={`paymode-${v}`}
                aria-pressed={payMode === v}
                onClick={() => setParam('pm', v === 'due' ? null : v)}
                className={cn('px-3 py-1 text-sm', payMode === v ? 'bg-purple-600 text-white' : 'bg-white text-purple-800 hover:bg-purple-50')}
              >
                {label}
              </button>
            ))}
          </div>
          <DateInput className="w-36 shrink-0" value={payFrom} onChange={(e) => setParam('from', e.target.value)} placeholder="מתאריך" data-testid="pay-from" />
          <DateInput className="w-36 shrink-0" value={payTo} onChange={(e) => setParam('to', e.target.value)} placeholder="עד תאריך" data-testid="pay-to" />
          <span className="text-xs text-muted-foreground">צפוי = מחשבון עסקה שהופק</span>
          {anyFilterActive && (
            <Button size="sm" variant="outline" className="mr-auto" onClick={clearAllFilters} data-testid="clear-filters">
              נקה סינונים
            </Button>
          )}
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-purple-400">טוען...</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-gray-400">לא נמצאו עסקאות</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-purple-50">
                  <SortableHead col="client_name" label="לקוח" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right text-purple-800 font-semibold">משרה / מועמד</TableHead>
                  <SortableHead col="salary" label="שכר" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="commission_percent" label="% עמלה" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="service_lead" label="מוביל" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="close_date" label="תאריך סגירה" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="work_start_date" label="תחילת עבודה" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="net_invoice_amount" label="סכום חשבונית" sort={sort} onToggle={toggleSort} />
                  {showSupplier && (
                    <SortableHead col="supplier_amount_calc" label="עמלת ספק" sort={sort} onToggle={toggleSort} />
                  )}
                  <SortableHead col="income_calc" label="הכנסה" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right text-purple-800 font-semibold">
                    <Popover>
                      <PopoverTrigger
                        className="inline-flex items-center gap-1 font-semibold hover:text-purple-600"
                        data-testid="billing-filter-trigger"
                      >
                        חיובים
                        <Filter className={cn('h-3.5 w-3.5', billBuckets.size > 0 && 'fill-purple-600 text-purple-600')} />
                        {billBuckets.size > 0 && (
                          <span className="rounded-full bg-purple-600 px-1.5 text-[10px] leading-4 text-white">{billBuckets.size}</span>
                        )}
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56" dir="rtl">
                        {[...BILL_BUCKETS, { key: 'none', label: 'ללא חיובים' }].map((b) => (
                          <label key={b.key} className="flex items-center gap-2 text-sm cursor-pointer font-normal">
                            <Checkbox checked={billBuckets.has(b.key)} onCheckedChange={() => toggleBucket(b.key)} data-testid={`bill-${b.key}`} />
                            {b.label}
                          </label>
                        ))}
                        <Button size="sm" variant="outline" disabled={billBuckets.size === 0} onClick={() => setParam('bill', null)}>נקה</Button>
                      </PopoverContent>
                    </Popover>
                  </TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((t) => {
                  const events = eventsByTxn.get(t.id) ?? []
                  const isUnapproved = t.needs_approval && !t.approved_at
                  const positionCandidate = [t.position_name, t.candidate_name].filter(Boolean).join(' · ')
                  return (
                    <TableRow
                      key={t.id}
                      className={cn(
                        'cursor-pointer hover:bg-purple-50/50 transition-colors',
                        isUnapproved ? 'opacity-50' : '',
                      )}
                      onClick={() => openEdit(t)}
                    >
                      <TableCell className="text-right font-medium">
                        {t.client_name}
                        {isUnapproved && (
                          <Badge variant="outline" className="block w-fit mt-0.5 text-amber-600 border-amber-400 text-xs font-normal">
                            ממתין לאישור
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.kind === 'time_period' ? (
                          <span className="text-xs text-muted-foreground">
                            {t.period_start ?? ''} → {t.period_end ?? ''}
                          </span>
                        ) : positionCandidate || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.kind === 'service' ? formatCurrency(t.salary) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.kind === 'service' && t.commission_percent ? `${t.commission_percent}%` : '—'}
                      </TableCell>
                      <TableCell className="text-right">{t.service_lead || '—'}</TableCell>
                      <TableCell className="text-right">
                        <DateCell value={t.close_date} />
                      </TableCell>
                      <TableCell className="text-right">
                        <DateCell value={t.work_start_date} />
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(t.net_invoice_amount)}</TableCell>
                      {showSupplier && (
                        <TableCell className="text-right">
                          {toAgorot(t.supplier_percent) > 0 ? formatCurrency(txSupplierAmount(t)) : '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-right">{formatCurrency(txIncome(t))}</TableCell>
                      <TableCell className="text-right">
                        <BillingDots events={events} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          {canApprove && isUnapproved && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-700 hover:bg-green-50"
                              title="אשר עסקה"
                              aria-label="אשר עסקה"
                              onClick={() => approveMut.mutate(t.id)}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-purple-600 hover:bg-purple-100" onClick={() => openEdit(t)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDelete(t)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-purple-50 hover:bg-purple-50 border-t-2 border-purple-200 font-semibold text-purple-900">
                  <TableCell className="text-right">
                    {totals.count === 1 ? 'סה"כ · עסקה אחת' : `סה"כ · ${totals.count} עסקאות`}
                  </TableCell>
                  <TableCell className="text-right" />
                  <TableCell className="text-right" />
                  <TableCell className="text-right" />
                  <TableCell className="text-right" />
                  <TableCell className="text-right" />
                  <TableCell className="text-right" />
                  <TableCell className="text-right">
                    {formatCurrency(totals.invoiceTotal)}
                    {totals.pendingApprovalCount > 0 && (
                      <span className="block text-xs text-amber-600 font-normal">
                        מתוכם ממתין לאישור: {formatCurrency(totals.pendingApprovalTotal)}
                      </span>
                    )}
                  </TableCell>
                  {showSupplier && (
                    <TableCell className="text-right">{formatCurrency(totals.supplierTotal)}</TableCell>
                  )}
                  <TableCell className="text-right">{formatCurrency(totals.incomeTotal)}</TableCell>
                  <TableCell className="text-right" />
                  <TableCell className="text-right" />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </Card>

      <DeleteTransactionDialog
        deal={deleting}
        allDeals={transactions}
        events={deleting ? eventsByTxn.get(deleting.id) ?? [] : []}
        onClose={() => setDeleting(null)}
      />

      <TransactionDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editing={editing}
      />
    </div>
  )
}
