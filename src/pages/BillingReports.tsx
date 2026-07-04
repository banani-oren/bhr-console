import { useMemo, useState, useEffect } from 'react'
import { DateInput } from '@/components/ui/date-input'
import { useQuery } from '@tanstack/react-query'
import { FileText, FileDown, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { generatePerformaPDF } from '@/lib/pdf'
import type {
  BillingEvent,
  BillingEventStatus,
  Transaction,
} from '@/lib/types'
import type { ServiceType } from '@/lib/serviceTypes'
import ClientPicker from '@/components/ClientPicker'
import { DateCell } from '@/components/ui/date-cell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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

const STATUS_LABEL: Record<BillingEventStatus, string> = {
  pending: 'ממתין',
  to_bill: 'לחיוב',
  billed: 'חויב',
  paid: 'שולם',
  cancelled: 'מבוטל',
}
// Green/emerald = paid (money received) only. billed = amber (awaiting
// payment); pending = gray (not yet actionable).
const STATUS_BADGE: Record<BillingEventStatus, string> = {
  pending: 'bg-gray-50 text-gray-700 border-gray-200',
  to_bill: 'bg-blue-50 text-blue-700 border-blue-200',
  billed: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
}

const formatCurrency = (n: number | null | undefined) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n)
}

export default function BillingReports() {
  const [clientId, setClientId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [serviceTypeFilter, setServiceTypeFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>({ key: 'billing_date', dir: 'desc' })
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

  const { data: rawEvents = [], refetch } = useQuery<EventWithTxn[]>({
    queryKey: ['billing_events_dashboard', clientId, statusFilter, dateFrom, dateTo, serviceTypeFilter],
    queryFn: async () => {
      let q = supabase
        .from('billing_events')
        .select('*, transactions!inner(client_name, client_id, service_type, service_type_id, needs_approval, approved_at)')
        .order('billing_date', { ascending: true })
      if (clientId) q = q.eq('transactions.client_id', clientId)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      // Paid events are reported by when they were actually received
      // (payment_date), not when they were originally invoiced.
      const dateColumn = statusFilter === 'paid' ? 'payment_date' : 'billing_date'
      if (dateFrom) q = q.gte(dateColumn, dateFrom)
      if (dateTo) q = q.lte(dateColumn, dateTo)
      if (serviceTypeFilter !== 'all') q = q.eq('transactions.service_type', serviceTypeFilter)
      const { data, error } = await q
      if (error) throw error
      // Exclude events of unapproved transactions.
      return ((data ?? []) as EventWithTxn[]).filter(
        (e) => !e.transactions.needs_approval || e.transactions.approved_at,
      )
    },
  })

  const filteredEvents = useMemo(() => {
    if (!searchDebounced) return rawEvents
    return rawEvents.filter((e) => {
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
  }, [rawEvents, searchDebounced])

  const getEventSortValue = (e: EventWithTxn, key: string): unknown => {
    switch (key) {
      case 'client_name': return e.transactions.client_name
      case 'amount': return Number(e.amount)
      default: return (e as Record<string, unknown>)[key] // description, billing_date, payment_date, status
    }
  }

  const sortedEvents = useMemo(() => {
    const arr = [...filteredEvents]
    arr.sort((a, b) => compareBySort(a, b, sort, getEventSortValue))
    return arr
  }, [filteredEvents, sort])

  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = (e: EventWithTxn) =>
    e.billing_date != null
    && e.billing_date < today
    && e.status !== 'billed'
    && e.status !== 'paid'
    && e.status !== 'cancelled'

  const selectedEvents = useMemo(
    () => filteredEvents.filter((e) => selectedIds.has(e.id)),
    [filteredEvents, selectedIds],
  )
  const uniqueClients = useMemo(
    () => new Set(selectedEvents.map((e) => e.transactions.client_name ?? '')).size,
    [selectedEvents],
  )

  const allVisibleSelected =
    filteredEvents.length > 0 && filteredEvents.every((e) => selectedIds.has(e.id))

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredEvents.map((e) => e.id)))
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

  // Totals
  const totals = useMemo(() => {
    let toBill = 0, billed = 0, paid = 0, outstanding = 0
    for (const e of filteredEvents) {
      const amount = Number(e.amount) || 0
      if (e.status === 'to_bill') toBill += amount
      // "סה"כ חויב" = cumulative amount ever invoiced, whether or not it has
      // since been paid.
      if (e.status === 'billed' || e.status === 'paid') billed += amount
      if (e.status === 'paid') paid += amount
      // "יתרה לגבייה" = invoiced but not yet paid (matches the accuracy rule:
      // לגבייה = billed only).
      if (e.status === 'billed') outstanding += amount
    }
    return { toBill, billed, paid, outstanding }
  }, [filteredEvents])

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">דוחות חיוב</h1>
      </div>

      <Card className="p-4">
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
          <div className="w-44 shrink-0">
            <ClientPicker
              value={clientId}
              onChange={(id) => setClientId(id)}
              allSentinelLabel="כל הלקוחות"
              placeholder="כל הלקוחות"
            />
          </div>

          {/* Status */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
            <SelectTrigger className="w-28 shrink-0">
              <span className="text-sm truncate">
                {statusFilter === 'all' ? 'סטטוס' : STATUS_LABEL[statusFilter as BillingEventStatus] ?? statusFilter}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכל</SelectItem>
              <SelectItem value="pending">ממתין</SelectItem>
              <SelectItem value="to_bill">לחיוב</SelectItem>
              <SelectItem value="billed">חויב</SelectItem>
              <SelectItem value="paid">שולם</SelectItem>
              <SelectItem value="cancelled">מבוטל</SelectItem>
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
              <SelectItem value="שעות עבודה">שעות עבודה</SelectItem>
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
        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">אין חיובים להצגה</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-purple-50">
                  <TableHead className="w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="בחר הכל"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                    />
                  </TableHead>
                  <SortableHead col="client_name" label="לקוח" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right text-purple-800">שירות</TableHead>
                  <SortableHead col="description" label="תיאור" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="billing_date" label="תאריך חיוב" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="amount" label="סכום" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="status" label="סטטוס" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right text-purple-800">חשבון עסקה</TableHead>
                  <SortableHead col="payment_date" label="תאריך תשלום" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right text-purple-800">קבלה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEvents.map((e) => (
                  <BillingEventDashRow
                    key={e.id}
                    event={e}
                    overdue={isOverdue(e)}
                    onChanged={() => refetch()}
                    selected={selectedIds.has(e.id)}
                    onToggleSelect={() => toggleSelect(e.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {filteredEvents.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t bg-purple-50/40 text-sm">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">סה"כ לחיוב:</span>
              <span className="font-semibold">{formatCurrency(totals.toBill)}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">סה"כ חויב:</span>
              <span className="font-semibold text-amber-700">{formatCurrency(totals.billed)}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">יתרה לגבייה:</span>
              <span className="font-semibold text-amber-700">{formatCurrency(totals.outstanding)}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">סה"כ שולם:</span>
              <span className="font-semibold text-emerald-700">{formatCurrency(totals.paid)}</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function BillingEventDashRow({
  event,
  overdue,
  onChanged,
  selected,
  onToggleSelect,
}: {
  event: EventWithTxn
  overdue: boolean
  onChanged: () => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const [invoice, setInvoice] = useState(event.invoice_number ?? '')
  const [paymentDate, setPaymentDate] = useState(event.payment_date ?? '')
  const [receipt, setReceipt] = useState(event.receipt_number ?? '')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setInvoice(event.invoice_number ?? '')
    setPaymentDate(event.payment_date ?? '')
    setReceipt(event.receipt_number ?? '')
  }, [event.id, event.invoice_number, event.payment_date, event.receipt_number])

  const saveField = async (
    field: 'invoice_number' | 'payment_date' | 'receipt_number',
    value: string,
  ) => {
    setBusy(field)
    const patch: Record<string, unknown> = { [field]: value || null }
    if (field === 'invoice_number' && value && event.status !== 'billed') {
      patch.status = 'billed'
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error } = await supabase.from('billing_events').update(patch).eq('id', event.id).abortSignal(controller.signal)
      if (error) throw error
      onChanged()
    } catch (err) {
      console.error(err)
    } finally {
      clearTimeout(timer)
      setBusy(null)
    }
  }

  return (
    <TableRow className={`hover:bg-purple-50/30 ${selected ? 'bg-purple-50/40' : ''}`}>
      <TableCell className="text-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label="בחר חיוב"
        />
      </TableCell>
      <TableCell className="font-medium">{event.transactions.client_name}</TableCell>
      <TableCell>{event.transactions.service_type ?? '—'}</TableCell>
      <TableCell className="text-xs">{event.description ?? '—'}</TableCell>
      <TableCell className={overdue ? 'text-red-600 font-medium' : ''}>
        <DateCell value={event.billing_date} />
      </TableCell>
      <TableCell>{formatCurrency(event.amount)}</TableCell>
      <TableCell>
        <Badge variant="outline" className={`${STATUS_BADGE[event.status]} text-xs`}>
          {STATUS_LABEL[event.status]}
        </Badge>
      </TableCell>
      <TableCell>
        <Input
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          onBlur={() => invoice !== (event.invoice_number ?? '') && saveField('invoice_number', invoice)}
          className="h-8 text-xs"
          placeholder={busy === 'invoice_number' ? 'שומר...' : ''}
        />
      </TableCell>
      <TableCell>
        <DateInput
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          onBlur={() => paymentDate !== (event.payment_date ?? '') && saveField('payment_date', paymentDate)}
          className="h-8 text-xs"
        />
      </TableCell>
      <TableCell>
        <Input
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
          onBlur={() => receipt !== (event.receipt_number ?? '') && saveField('receipt_number', receipt)}
          className="h-8 text-xs"
        />
      </TableCell>
    </TableRow>
  )
}
