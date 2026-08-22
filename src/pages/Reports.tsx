import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, BarChart3, FileDown, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Transaction } from '@/lib/types'
import { DateInput } from '@/components/ui/date-input'
import { DateCell } from '@/components/ui/date-cell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
import { exportSheetsToExcel } from '@/lib/excelExport'

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NONE_LABEL = '— ללא —'

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  return Math.round((to - from) / (1000 * 60 * 60 * 24))
}

type EnrichedTxn = Transaction & { incomeReceived: number }

type GroupRow = {
  key: string
  opened: number
  closed: number
  closeRatio: number | null
  avgDays: number | null
  totalCommission: number
  incomeReceived: number
  transactions: EnrichedTxn[]
}

function groupBy(rows: EnrichedTxn[], keyFn: (t: EnrichedTxn) => string): GroupRow[] {
  const map = new Map<string, EnrichedTxn[]>()
  for (const t of rows) {
    const key = keyFn(t) || NONE_LABEL
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  const groups: GroupRow[] = []
  for (const [key, txns] of map) {
    const opened = txns.length
    const closedTxns = txns.filter((t) => !!t.close_date)
    const closed = closedTxns.length
    const closeRatio = opened > 0 ? Math.round((closed / opened) * 1000) / 10 : null
    const avgDays =
      closed > 0
        ? Math.round(
            closedTxns.reduce((sum, t) => sum + daysBetween(t.entry_date, t.close_date!), 0) / closed,
          )
        : null
    const totalCommission = txns.reduce((sum, t) => sum + (Number(t.net_invoice_amount) || 0), 0)
    const incomeReceived = txns.reduce((sum, t) => sum + t.incomeReceived, 0)
    groups.push({ key, opened, closed, closeRatio, avgDays, totalCommission, incomeReceived, transactions: txns })
  }
  return groups
}

function getGroupSortValue(row: GroupRow, key: string): unknown {
  switch (key) {
    case 'key': return row.key
    case 'opened': return row.opened
    case 'closed': return row.closed
    case 'closeRatio': return row.closeRatio
    case 'avgDays': return row.avgDays
    case 'totalCommission': return row.totalCommission
    case 'incomeReceived': return row.incomeReceived
    default: return null
  }
}

function sortGroups(rows: GroupRow[], sort: SortState): GroupRow[] {
  const arr = [...rows]
  arr.sort((a, b) => {
    if (a.key === NONE_LABEL && b.key === NONE_LABEL) return 0
    if (a.key === NONE_LABEL) return 1
    if (b.key === NONE_LABEL) return -1
    return compareBySort(a, b, sort, getGroupSortValue)
  })
  return arr
}

function defaultDateFrom(): string {
  return `${new Date().getFullYear()}-01-01`
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function Reports() {
  const [reportKind, setReportKind] = useState<'giyus'>('giyus')
  const [dateFrom, setDateFrom] = useState(defaultDateFrom())
  const [dateTo, setDateTo] = useState(today())
  const [leadFilter, setLeadFilter] = useState<string>('all')
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')

  const { data: transactions = [], isLoading, error } = useQuery<Transaction[]>({
    queryKey: ['reports_giyus_transactions', dateFrom, dateTo],
    queryFn: async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
      try {
        let q = supabase
          .from('transactions')
          .select('*')
          .eq('service_type', 'גיוס')
          .order('entry_date', { ascending: false })
          .abortSignal(controller.signal)
        if (dateFrom) q = q.gte('entry_date', dateFrom)
        if (dateTo) q = q.lte('entry_date', dateTo)
        const { data, error } = await q
        if (error) throw error
        return (data ?? []) as Transaction[]
      } finally {
        clearTimeout(timer)
      }
    },
  })

  const txnIds = useMemo(() => transactions.map((t) => t.id), [transactions])

  const { data: paidEvents = [] } = useQuery<{ transaction_id: string; amount: number }[]>({
    queryKey: ['reports_giyus_paid_events', txnIds],
    enabled: txnIds.length > 0,
    queryFn: async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
      try {
        const { data, error } = await supabase
          .from('billing_events')
          .select('transaction_id, amount')
          .eq('status', 'paid')
          .in('transaction_id', txnIds)
          .abortSignal(controller.signal)
        if (error) throw error
        return (data ?? []) as { transaction_id: string; amount: number }[]
      } finally {
        clearTimeout(timer)
      }
    },
  })

  const enrichedTxns = useMemo<EnrichedTxn[]>(() => {
    const incomeByTxn = new Map<string, number>()
    for (const e of paidEvents) {
      incomeByTxn.set(e.transaction_id, (incomeByTxn.get(e.transaction_id) ?? 0) + (Number(e.amount) || 0))
    }
    return transactions.map((t) => ({ ...t, incomeReceived: incomeByTxn.get(t.id) ?? 0 }))
  }, [transactions, paidEvents])

  const distinctLeads = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.service_lead).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he')),
    [transactions],
  )
  const distinctClients = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.client_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he')),
    [transactions],
  )

  const searchLower = searchInput.trim().toLowerCase()
  const filteredTxns = useMemo(() => {
    return enrichedTxns.filter((t) => {
      if (leadFilter !== 'all' && t.service_lead !== leadFilter) return false
      if (clientFilter !== 'all' && t.client_name !== clientFilter) return false
      if (searchLower) {
        const haystack = [t.client_name, t.position_name, t.candidate_name].filter(Boolean).map((s) => String(s).toLowerCase())
        if (!haystack.some((s) => s.includes(searchLower))) return false
      }
      return true
    })
  }, [enrichedTxns, leadFilter, clientFilter, searchLower])

  // KPIs
  const kpi = useMemo(() => {
    const opened = filteredTxns.length
    const closedTxns = filteredTxns.filter((t) => !!t.close_date)
    const closed = closedTxns.length
    const closeRatio = opened > 0 ? Math.round((closed / opened) * 1000) / 10 : null
    const avgDays =
      closed > 0
        ? Math.round(closedTxns.reduce((sum, t) => sum + daysBetween(t.entry_date, t.close_date!), 0) / closed)
        : null
    const incomeReceived = filteredTxns.reduce((sum, t) => sum + t.incomeReceived, 0)
    return { opened, closed, closeRatio, avgDays, incomeReceived }
  }, [filteredTxns])

  const [sortLead, setSortLead] = useState<SortState>({ key: 'incomeReceived', dir: 'desc' })
  const [sortClient, setSortClient] = useState<SortState>({ key: 'incomeReceived', dir: 'desc' })
  const [sortPosition, setSortPosition] = useState<SortState>({ key: 'incomeReceived', dir: 'desc' })

  const groupsByLead = useMemo(() => sortGroups(groupBy(filteredTxns, (t) => t.service_lead), sortLead), [filteredTxns, sortLead])
  const groupsByClient = useMemo(() => sortGroups(groupBy(filteredTxns, (t) => t.client_name), sortClient), [filteredTxns, sortClient])
  const groupsByPosition = useMemo(() => sortGroups(groupBy(filteredTxns, (t) => t.position_name), sortPosition), [filteredTxns, sortPosition])

  const [expandedLead, setExpandedLead] = useState<string | null>(null)
  const [expandedClient, setExpandedClient] = useState<string | null>(null)
  const [expandedPosition, setExpandedPosition] = useState<string | null>(null)

  const handleExport = () => {
    const summaryRows = [
      { מדד: 'נפתחו', ערך: kpi.opened },
      { מדד: 'נסגרו', ערך: kpi.closed },
      { מדד: 'יחס סגירה %', ערך: kpi.closeRatio ?? '—' },
      { מדד: 'ממוצע ימים לסגירה', ערך: kpi.avgDays ?? '—' },
      { מדד: 'הכנסה שהתקבלה (₪)', ערך: kpi.incomeReceived },
    ]
    const groupRowsFor = (groups: GroupRow[], labelKey: string) =>
      groups.map((g) => ({
        [labelKey]: g.key,
        נפתחו: g.opened,
        נסגרו: g.closed,
        'יחס סגירה %': g.closeRatio ?? '—',
        'ממוצע ימים': g.avgDays ?? '—',
        'סה"כ עמלות': g.totalCommission,
        'הכנסה שהתקבלה': g.incomeReceived,
      }))
    exportSheetsToExcel(
      [
        { name: 'סיכום', rows: summaryRows },
        { name: 'לפי מוביל', rows: groupRowsFor(groupsByLead, 'מוביל') },
        { name: 'לפי לקוח', rows: groupRowsFor(groupsByClient, 'לקוח') },
        { name: 'לפי משרה', rows: groupRowsFor(groupsByPosition, 'משרה') },
      ],
      `דוח-גיוסים-${dateFrom}-${dateTo}.xlsx`,
    )
  }

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-purple-900">דוחות</h1>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={filteredTxns.length === 0}>
          <FileDown className="w-4 h-4 ml-1" />
          ייצוא לאקסל
        </Button>
      </div>

      <div className="w-56">
        <Select value={reportKind} onValueChange={(v) => setReportKind((v as 'giyus') ?? 'giyus')}>
          <SelectTrigger>
            <span className="text-sm">דוח גיוסים</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="giyus">דוח גיוסים</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="חפש לפי לקוח, משרה, מועמד..."
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

          <DateInput className="w-36 shrink-0" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="מתאריך" />
          <DateInput className="w-36 shrink-0" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="עד תאריך" />

          <Select value={leadFilter} onValueChange={(v) => setLeadFilter(v ?? 'all')}>
            <SelectTrigger className="w-36 shrink-0">
              <span className="text-sm truncate">{leadFilter === 'all' ? 'כל המובילים' : leadFilter}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המובילים</SelectItem>
              {distinctLeads.map((l) => (<SelectItem key={l} value={l}>{l}</SelectItem>))}
            </SelectContent>
          </Select>

          <Select value={clientFilter} onValueChange={(v) => setClientFilter(v ?? 'all')}>
            <SelectTrigger className="w-44 shrink-0">
              <span className="text-sm truncate">{clientFilter === 'all' ? 'כל הלקוחות' : clientFilter}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הלקוחות</SelectItem>
              {distinctClients.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">טוען...</div>
      ) : error ? (
        <div className="p-8 text-center text-destructive text-sm">שגיאה בטעינת הנתונים. נסה שוב.</div>
      ) : filteredTxns.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">לא נמצאו גיוסים בטווח התאריכים שנבחר.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard title="נפתחו" value={String(kpi.opened)} />
            <KpiCard title="נסגרו" value={String(kpi.closed)} />
            <KpiCard title="יחס סגירה %" value={kpi.closeRatio != null ? `${kpi.closeRatio}%` : '—'} />
            <KpiCard title="ממוצע ימים לסגירה" value={kpi.avgDays != null ? String(kpi.avgDays) : '—'} />
            <KpiCard title="הכנסה שהתקבלה" value={ILS.format(kpi.incomeReceived)} />
          </div>

          <GroupBlock
            title="לפי מוביל"
            labelHeader="מוביל"
            groups={groupsByLead}
            sort={sortLead}
            onToggleSort={(key) => setSortLead((prev) => toggleSortKey(prev, key))}
            expandedKey={expandedLead}
            onToggleExpand={(key) => setExpandedLead((prev) => (prev === key ? null : key))}
          />

          <GroupBlock
            title="לפי לקוח"
            labelHeader="לקוח"
            groups={groupsByClient}
            sort={sortClient}
            onToggleSort={(key) => setSortClient((prev) => toggleSortKey(prev, key))}
            expandedKey={expandedClient}
            onToggleExpand={(key) => setExpandedClient((prev) => (prev === key ? null : key))}
          />

          <GroupBlock
            title="לפי משרה"
            labelHeader="משרה"
            groups={groupsByPosition}
            sort={sortPosition}
            onToggleSort={(key) => setSortPosition((prev) => toggleSortKey(prev, key))}
            expandedKey={expandedPosition}
            onToggleExpand={(key) => setExpandedPosition((prev) => (prev === key ? null : key))}
          />
        </>
      )}
    </div>
  )
}

function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
      </CardContent>
    </Card>
  )
}

function GroupBlock({
  title,
  labelHeader,
  groups,
  sort,
  onToggleSort,
  expandedKey,
  onToggleExpand,
}: {
  title: string
  labelHeader: string
  groups: GroupRow[]
  sort: SortState
  onToggleSort: (key: string) => void
  expandedKey: string | null
  onToggleExpand: (key: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-purple-50">
                <TableHead className="w-8" />
                <SortableHead col="key" label={labelHeader} sort={sort} onToggle={onToggleSort} />
                <SortableHead col="opened" label="נפתחו" sort={sort} onToggle={onToggleSort} />
                <SortableHead col="closed" label="נסגרו" sort={sort} onToggle={onToggleSort} />
                <SortableHead col="closeRatio" label="יחס סגירה" sort={sort} onToggle={onToggleSort} />
                <SortableHead col="avgDays" label="ממוצע ימים" sort={sort} onToggle={onToggleSort} />
                <SortableHead col="totalCommission" label='סה"כ עמלות' sort={sort} onToggle={onToggleSort} />
                <SortableHead col="incomeReceived" label="הכנסה שהתקבלה" sort={sort} onToggle={onToggleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <GroupRows
                  key={g.key}
                  group={g}
                  expanded={expandedKey === g.key}
                  onToggleExpand={() => onToggleExpand(g.key)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function GroupRows({
  group,
  expanded,
  onToggleExpand,
}: {
  group: GroupRow
  expanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <>
      <TableRow className="hover:bg-purple-50/30 cursor-pointer" onClick={onToggleExpand}>
        <TableCell className="text-center">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronLeft className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-medium">{group.key}</TableCell>
        <TableCell>{group.opened}</TableCell>
        <TableCell>{group.closed}</TableCell>
        <TableCell>{group.closeRatio != null ? `${group.closeRatio}%` : '—'}</TableCell>
        <TableCell>{group.avgDays != null ? group.avgDays : '—'}</TableCell>
        <TableCell>{ILS.format(group.totalCommission)}</TableCell>
        <TableCell>{ILS.format(group.incomeReceived)}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-purple-50/20 p-0">
            <div className="overflow-x-auto p-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right text-purple-700 text-xs">לקוח</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">מספר משרה</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">שם משרה</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">מועמד</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">מוביל</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">תאריך פתיחה</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">תאריך סגירה</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">ימים</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">סכום נטו</TableHead>
                    <TableHead className="text-right text-purple-700 text-xs">התקבל</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.transactions.map((t) => (
                    <TableRow key={t.id} className="text-xs">
                      <TableCell>{t.client_name}</TableCell>
                      <TableCell>{(t.custom_fields?.position_number as string) ?? '—'}</TableCell>
                      <TableCell>{t.position_name || '—'}</TableCell>
                      <TableCell>{t.candidate_name || '—'}</TableCell>
                      <TableCell>{t.service_lead || '—'}</TableCell>
                      <TableCell><DateCell value={t.entry_date} /></TableCell>
                      <TableCell>{t.close_date ? <DateCell value={t.close_date} /> : '—'}</TableCell>
                      <TableCell>{t.close_date ? daysBetween(t.entry_date, t.close_date) : '—'}</TableCell>
                      <TableCell>{ILS.format(Number(t.net_invoice_amount) || 0)}</TableCell>
                      <TableCell>{ILS.format(t.incomeReceived)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
