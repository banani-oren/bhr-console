import { useState, useMemo, useEffect } from 'react'
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react'
import { DateCell } from '@/components/ui/date-cell'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTable, useDelete } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import type {
  BillingEvent,
  BillingEventStatus,
  Transaction,
} from '@/lib/types'
import type { ServiceType } from '@/lib/serviceTypes'
import TransactionDialog from '@/components/TransactionDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
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

  const remove = useDelete('transactions')

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
  const [searchInput, setSearchInput] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [filterClosingMonth, setFilterClosingMonth] = useState<string>('all')
  const [sort, setSort] = useState<SortState>({ key: 'close_date', dir: 'desc' })
  const toggleSort = (key: string) => setSort((prev) => toggleSortKey(prev, key))

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
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

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (!searchMatches(t, searchDebounced)) return false
      if (filterClosingMonth !== 'all' && t.closing_month !== Number(filterClosingMonth)) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, searchDebounced, filterClosingMonth, serviceNameById])

  const getSortValue = (t: Transaction, key: string): unknown =>
    key === 'service_type' ? resolveServiceName(t) : (t as Record<string, unknown>)[key]

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => compareBySort(a, b, sort, getSortValue))
    return arr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, serviceNameById])

  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const openAdd = () => { setEditing(null); setWizardOpen(true) }
  const openEdit = (t: Transaction) => { setEditing(t); setWizardOpen(true) }

  const handleDelete = async (id: string) => {
    if (confirm('האם למחוק עסקה זו?')) await remove.mutateAsync(id)
  }

  const canApprove = profile?.role === 'admin' || profile?.role === 'administration'

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

          {/* Closing month — to the left of the search bar */}
          <Select value={filterClosingMonth} onValueChange={(v) => setFilterClosingMonth(v ?? 'all')}>
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
                  <SortableHead col="service_type" label="שירות" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right text-purple-800 font-semibold">משרה / מועמד</TableHead>
                  <SortableHead col="salary" label="שכר" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="commission_percent" label="% עמלה" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="service_lead" label="מוביל" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="close_date" label="תאריך סגירה" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="work_start_date" label="תחילת עבודה" sort={sort} onToggle={toggleSort} />
                  <SortableHead col="net_invoice_amount" label="סכום נטו" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right text-purple-800 font-semibold">חיובים</TableHead>
                  <TableHead className="text-right text-purple-800 font-semibold">אישור</TableHead>
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
                      <TableCell className="text-right font-medium">{t.client_name}</TableCell>
                      <TableCell className="text-right">{resolveServiceName(t) || '—'}</TableCell>
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
                      <TableCell className="text-right">
                        <BillingDots events={events} />
                      </TableCell>
                      <TableCell className="text-right">
                        {isUnapproved ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs">
                            ממתין לאישור
                          </Badge>
                        ) : t.approved_at ? (
                          <Badge variant="outline" className="text-green-600 border-green-400 text-xs">
                            מאושר ✓
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          {canApprove && isUnapproved && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-700 border-green-400 hover:bg-green-50 text-xs"
                              onClick={() => approveMut.mutate(t.id)}
                            >
                              אשר
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-purple-600 hover:bg-purple-100" onClick={() => openEdit(t)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDelete(t.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <TransactionDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editing={editing}
      />
    </div>
  )
}
