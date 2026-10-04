import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Trophy, ChevronLeft, ChevronDown, Search, X } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import type { Profile, Transaction } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableFooter, TableHeader, TableRow,
} from '@/components/ui/table'
import { DateCell } from '@/components/ui/date-cell'
import { SortableHead, toggleSortKey, compareBySort, type SortState } from '@/components/SortableHead'
import TransactionDialog from '@/components/TransactionDialog'
import {
  fetchBonusEvents,
  buildBonusLedger,
  currentMonthKey,
  normalizeLead,
  actualForecastProgress,
  type BonusEvent,
  type LedgerMonth,
} from '@/lib/bonus'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]
const HEBREW_MONTHS_SHORT = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ',
  'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
]

const ROLE_LABELS_HE: Record<string, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתין',
  to_bill: 'לחיוב',
  billed: 'חויב',
  paid: 'שולם',
}
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-50 text-gray-700 border-gray-200',
  to_bill: 'bg-blue-50 text-blue-700 border-blue-200',
  billed: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-300',
}

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

type SortKey = 'name' | 'revenue' | 'bonus'

const SORT_LABELS: Record<SortKey, string> = {
  bonus: 'בונוס (יורד)',
  revenue: 'הכנסה (יורד)',
  name: 'שם (א-ת)',
}

const TODAY = new Date()
const pad2 = (n: number) => String(n).padStart(2, '0')
const monthKeyOf = (y: number, m: number) => `${y}-${pad2(m)}`

const EMPTY_MONTH: LedgerMonth = {
  actualRevenue: 0, expectedRevenue: 0, forecastRevenue: 0, actualBonus: 0, forecastBonus: 0,
  isPast: false, isCurrent: true, events: [],
}

/** payment_date for a paid (actual) event, due_date -> billing_date for an open (expected) one. */
function eventDisplayDate(e: BonusEvent): string | null {
  return e.kind === 'actual' ? (e.payment_date ?? e.due_date ?? e.billing_date) : (e.due_date ?? e.billing_date)
}

export default function Bonuses() {
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [periodMonth, setPeriodMonth] = useState<number>(TODAY.getMonth() + 1)
  const [periodYear, setPeriodYear] = useState<number>(TODAY.getFullYear())
  const [sortBy, setSortBy] = useState<SortKey>('bonus')

  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null)
  const [txnDialogOpen, setTxnDialogOpen] = useState(false)
  const [loadingTxnId, setLoadingTxnId] = useState<string | null>(null)

  const openTransaction = async (id: string) => {
    setLoadingTxnId(id)
    try {
      const { data, error } = await supabase.from('transactions').select('*').eq('id', id).single()
      if (!error && data) {
        setEditingTxn(data as Transaction)
        setTxnDialogOpen(true)
      }
    } finally {
      setLoadingTxnId(null)
    }
  }

  const todayKey = currentMonthKey()
  const selectedKey = monthKeyOf(periodYear, periodMonth)
  const isPastPeriod = selectedKey < todayKey

  // 6 months forward (תחזית) + current + 23 months back = 30 entries.
  const monthOptions = useMemo(() => {
    const out: { y: number; m: number; label: string; future: boolean }[] = []
    const todayM = TODAY.getMonth() + 1
    const todayY = TODAY.getFullYear()
    let y = todayY
    let m = todayM + 6
    while (m > 12) { m -= 12; y += 1 }
    for (let i = 0; i < 30; i++) {
      const future = y > todayY || (y === todayY && m > todayM)
      out.push({ y, m, future, label: `${HEBREW_MONTHS[m - 1]} ${y}${future ? ' (תחזית)' : ''}` })
      m -= 1
      if (m === 0) { m = 12; y -= 1 }
    }
    return out
  }, [])

  const { data: profiles = [], isLoading: profilesLoading, isError: profilesError } = useQuery<Profile[]>({
    queryKey: ['all-employees-for-bonuses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['admin', 'administration', 'recruiter'])
        .order('full_name', { ascending: true })
      if (error) throw error
      return data as Profile[]
    },
  })

  const { data: events = [], isLoading: eventsLoading, isError: eventsError, refetch: refetchEvents } = useQuery<BonusEvent[]>({
    queryKey: ['bonus-events'],
    queryFn: () => fetchBonusEvents(supabase),
  })

  type Row = {
    profile: Profile
    hasModel: boolean
    ledger: Map<string, LedgerMonth>
    month: LedgerMonth
    allEvents: BonusEvent[]
    noDateEvents: BonusEvent[]
    excludedForecastTotal: number
    progress: ReturnType<typeof actualForecastProgress>
    sortRevenue: number
    sortBonus: number
    reachedTier: boolean
  }

  const rows: Row[] = useMemo(() => {
    return profiles.map((p) => {
      const tiers = p.bonus_model?.tiers ?? []
      const mine = events.filter((e) => normalizeLead(e.service_lead) === normalizeLead(p.full_name))
      if (!p.bonus_model) {
        return {
          profile: p, hasModel: false, ledger: new Map(), month: EMPTY_MONTH,
          allEvents: mine, noDateEvents: [], excludedForecastTotal: 0, progress: actualForecastProgress(0, 0, []),
          sortRevenue: 0, sortBonus: 0, reachedTier: false,
        }
      }
      const ledger = buildBonusLedger(mine, tiers, todayKey)
      const month = ledger.get(selectedKey) ?? EMPTY_MONTH
      const progress = actualForecastProgress(month.actualRevenue, month.forecastRevenue, tiers)
      const noDateEvents = mine.filter((e) => e.monthKey == null)
      // Repair 18: open events excluded from every forecast because the
      // client's payment terms are missing/unparseable — reported, not
      // silently dropped (§3.5).
      const excludedForecastTotal = mine
        .filter((e) => e.excludedFromForecast)
        .reduce((s, e) => s + e.net, 0)
      return {
        profile: p,
        hasModel: true,
        ledger,
        month,
        allEvents: mine,
        noDateEvents,
        excludedForecastTotal,
        progress,
        sortRevenue: isPastPeriod ? month.actualRevenue : month.forecastRevenue,
        sortBonus: isPastPeriod ? month.actualBonus : month.forecastBonus,
        reachedTier: month.actualBonus > 0,
      }
    })
  }, [profiles, events, todayKey, selectedKey, isPastPeriod])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const arr = q
      ? rows.filter((r) => (r.profile.full_name ?? '').toLowerCase().includes(q))
      : [...rows]
    arr.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? '', 'he')
        case 'revenue':
          return b.sortRevenue - a.sortRevenue
        case 'bonus':
        default:
          return b.sortBonus - a.sortBonus
      }
    })
    return arr
  }, [rows, search, sortBy])

  const totalActualBonus = filteredRows.reduce((s, r) => s + r.month.actualBonus, 0)
  const totalForecastBonus = filteredRows.reduce((s, r) => s + r.month.forecastBonus, 0)
  const reachedCount = filteredRows.filter((r) => r.reachedTier).length

  const isLoading = profilesLoading || eventsLoading
  const isError = profilesError || eventsError

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">בונוסים</h1>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs text-purple-700">חיפוש לפי שם</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="הקלד שם עובד/ת..."
                className="pr-9 pl-9 border-purple-200 focus-visible:ring-purple-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
                  aria-label="נקה"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">תקופה</Label>
            <Select
              value={`${periodYear}-${periodMonth}`}
              onValueChange={(v) => {
                const [y, m] = (v ?? '').split('-').map(Number)
                if (y && m) { setPeriodYear(y); setPeriodMonth(m) }
              }}
            >
              <SelectTrigger>
                <span className="text-sm truncate">
                  {monthOptions.find((o) => o.y === periodYear && o.m === periodMonth)?.label
                    ?? `${HEBREW_MONTHS[periodMonth - 1]} ${periodYear}`}
                </span>
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">מיון</Label>
            <Select value={sortBy} onValueChange={(v) => setSortBy((v as SortKey) ?? 'bonus')}>
              <SelectTrigger>
                <span className="text-sm truncate">{SORT_LABELS[sortBy]}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bonus">בונוס (יורד)</SelectItem>
                <SelectItem value="revenue">הכנסה (יורד)</SelectItem>
                <SelectItem value="name">שם (א-ת)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">טוען נתוני בונוסים...</Card>
      ) : isError ? (
        <Card className="p-8 text-center space-y-2">
          <p className="text-sm text-destructive">שגיאה בטעינת נתוני הבונוסים.</p>
          <Button variant="outline" size="sm" onClick={() => void refetchEvents()}>נסה שנית</Button>
        </Card>
      ) : filteredRows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          {search ? 'לא נמצאו עובדים שתואמים לחיפוש.' : 'אין עובדים במערכת.'}
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredRows.map((row) => (
            <EmployeeCard
              key={row.profile.id}
              row={row}
              periodMonth={periodMonth}
              periodYear={periodYear}
              selectedKey={selectedKey}
              isPastPeriod={isPastPeriod}
              onEditModel={() => navigate(`/team?edit=${row.profile.id}`)}
              onOpenTransaction={openTransaction}
              loadingTxnId={loadingTxnId}
            />
          ))}
        </div>
      )}

      {!isLoading && !isError && filteredRows.length > 0 && (
        <Card className="p-4 bg-purple-50 border-purple-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm">
            <span className="text-purple-700">
              {filteredRows.length} עובדים · {reachedCount} הגיעו למדרגה
            </span>
            <span className="text-base font-semibold text-purple-900">
              סה&quot;כ בונוסים בפועל: {ILS.format(totalActualBonus)}
              <span className="text-xs font-normal text-purple-500 mr-2">
                סה&quot;כ תחזית: {ILS.format(totalForecastBonus)}
              </span>
            </span>
          </div>
        </Card>
      )}

      <TransactionDialog
        open={txnDialogOpen}
        onOpenChange={setTxnDialogOpen}
        editing={editingTxn}
      />
    </div>
  )
}

function EmployeeCard({
  row,
  periodMonth,
  periodYear,
  selectedKey,
  isPastPeriod,
  onEditModel,
  onOpenTransaction,
  loadingTxnId,
}: {
  row: {
    profile: Profile
    hasModel: boolean
    ledger: Map<string, LedgerMonth>
    month: LedgerMonth
    noDateEvents: BonusEvent[]
    excludedForecastTotal: number
    progress: ReturnType<typeof actualForecastProgress>
  }
  periodMonth: number
  periodYear: number
  selectedKey: string
  isPastPeriod: boolean
  onEditModel: () => void
  onOpenTransaction: (id: string) => void
  loadingTxnId: string | null
}) {
  const [dealsSort, setDealsSort] = useState<SortState | null>(null)
  const [noDateOpen, setNoDateOpen] = useState(false)
  const toggleDealsSort = (key: string) => setDealsSort((prev) => toggleSortKey(prev ?? { key, dir: 'desc' }, key))

  const initial = (row.profile.full_name || '?').charAt(0)

  if (!row.hasModel) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-zinc-300 text-zinc-700 flex items-center justify-center text-sm font-semibold">
                {initial}
              </div>
              <div>
                <CardTitle className="text-base font-semibold leading-tight">
                  {row.profile.full_name}
                </CardTitle>
                <Badge variant="secondary" className="mt-1 text-[11px] font-normal">
                  {ROLE_LABELS_HE[row.profile.role] ?? row.profile.role}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">מודל בונוס לא הוגדר</p>
          <Button variant="outline" size="sm" onClick={onEditModel} className="text-purple-700 border-purple-300">
            הגדר מודל <ChevronLeft className="w-3 h-3 ml-1" />
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { month, progress, ledger } = row
  const tiers = row.profile.bonus_model?.tiers ?? []

  // בונוסים מצטברים (עד התקופה): actual Jan->selected month; if the selected
  // month is current/future, also show the same sum with the final month's
  // actual swapped for its forecast (§3.2.6).
  const { ytdActual, ytdWithForecast } = useMemo(() => {
    let actualSum = 0
    for (let m = 1; m <= periodMonth; m++) {
      actualSum += ledger.get(monthKeyOf(periodYear, m))?.actualBonus ?? 0
    }
    if (isPastPeriod) return { ytdActual: actualSum, ytdWithForecast: null as number | null }
    let withForecast = 0
    for (let m = 1; m < periodMonth; m++) {
      withForecast += ledger.get(monthKeyOf(periodYear, m))?.actualBonus ?? 0
    }
    withForecast += ledger.get(selectedKey)?.forecastBonus ?? 0
    return { ytdActual: actualSum, ytdWithForecast: withForecast }
  }, [ledger, periodMonth, periodYear, isPastPeriod, selectedKey])

  // Does the forecast reach a higher tier than the actual one this month?
  const forecastTier = useMemo(() => {
    const sorted = [...tiers].sort((a, b) => a.min - b.min)
    let idx = -1
    for (let i = 0; i < sorted.length; i++) {
      if (month.forecastRevenue >= sorted[i].min) idx = i
      else break
    }
    const curMin = progress.currentTier?.min
    return idx >= 0 && sorted[idx].min !== curMin ? sorted[idx] : null
  }, [tiers, month.forecastRevenue, progress.currentTier])

  // 12 months of the selected year — stacked actual/forecast chart.
  const chartData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const key = monthKeyOf(periodYear, m)
      const entry = ledger.get(key)
      const actualBonus = entry?.actualBonus ?? 0
      const forecastBonus = entry?.forecastBonus ?? actualBonus
      return {
        month: HEBREW_MONTHS_SHORT[i],
        key,
        actualBonus,
        forecastDelta: Math.max(0, forecastBonus - actualBonus),
        forecastBonus,
      }
    })
  }, [ledger, periodYear])

  const dealsRows = useMemo(() => {
    const withDate = month.events.map((e) => ({ ...e, _date: eventDisplayDate(e) }))
    if (!dealsSort) {
      // Default grouping: paid (actual) first, then expected — each by date desc.
      return withDate.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'actual' ? -1 : 1
        return (b._date ?? '').localeCompare(a._date ?? '')
      })
    }
    const getValue = (e: typeof withDate[number], key: string): unknown => {
      switch (key) {
        case 'client_name': return e.client_name
        case 'position': return [e.position_name, e.candidate_name].filter(Boolean).join(' / ')
        case 'description': return e.description
        case 'net': return e.net
        case 'status': return e.status
        case 'date': return e._date
        case 'kind': return e.kind === 'actual' ? 'א' : 'ת'
        default: return null
      }
    }
    return [...withDate].sort((a, b) => compareBySort(a, b, dealsSort, getValue))
  }, [month.events, dealsSort])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-semibold">
              {initial}
            </div>
            <div>
              <CardTitle className="text-base font-semibold leading-tight">
                {row.profile.full_name}
              </CardTitle>
              <Badge variant="secondary" className="mt-1 text-[11px] font-normal">
                {ROLE_LABELS_HE[row.profile.role] ?? row.profile.role}
              </Badge>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onEditModel} className="text-purple-700 border-purple-300">
            ערוך מודל <ChevronLeft className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 1. Stat row — actual vs forecast, mandatory distinction (§2.3) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="הכנסה בפועל" value={ILS.format(month.actualRevenue)} />
          <Stat label="בונוס בפועל" value={ILS.format(month.actualBonus)} highlight />
          {isPastPeriod ? (
            <>
              <Stat label="הכנסה צפויה (תחזית)" value="—" note="חודש סגור" />
              <Stat label="בונוס צפוי (תחזית)" value="—" note="חודש סגור" />
            </>
          ) : (
            <>
              <Stat label="הכנסה צפויה (תחזית)" value={ILS.format(month.forecastRevenue)} forecast />
              <Stat label="בונוס צפוי (תחזית)" value={ILS.format(month.forecastBonus)} forecast />
            </>
          )}
        </div>

        {/* 2. Two-layer progress bar: solid = actual, light = forecast */}
        {progress.nextTier ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{ILS.format(progress.currentTier?.min ?? 0)}</span>
              <span>{ILS.format(progress.nextTier.min)}</span>
            </div>
            <div className="h-2 bg-muted rounded overflow-hidden relative">
              <div className="h-full bg-purple-200" style={{ width: `${progress.forecastPct}%` }} />
              <div className="h-full bg-purple-600 absolute inset-y-0 right-0" style={{ width: `${progress.actualPct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              עוד {ILS.format(progress.amountToNext)} למדרגת {ILS.format(progress.nextTier.bonus)}
              {forecastTier && (
                <span className="text-purple-500"> · בתחזית: מדרגת {ILS.format(forecastTier.bonus)}</span>
              )}
            </p>
          </div>
        ) : progress.currentTier ? (
          <p className="text-xs text-muted-foreground">מדרגה מקסימלית</p>
        ) : (
          <p className="text-xs text-muted-foreground">לא הגעת למדרגה הראשונה</p>
        )}

        {/* Repair 18, §3.5: open events excluded from every forecast because
            the client's payment terms are missing — reported, not dropped. */}
        {row.excludedForecastTotal > 0 && (
          <p className="text-xs text-amber-600">
            לא נכלל בתחזית: {ILS.format(row.excludedForecastTotal)} — תנאי תשלום חסרים
          </p>
        )}

        {/* 4. Deals table — replaces the old tier table */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-purple-700">עסקאות בתקופה</p>
          {dealsRows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center border rounded-md">אין עסקאות בחודש זה</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead col="client_name" label="לקוח" sort={dealsSort ?? { key: '', dir: 'desc' }} onToggle={toggleDealsSort} className="text-xs" />
                    <SortableHead col="position" label="משרה / מועמד" sort={dealsSort ?? { key: '', dir: 'desc' }} onToggle={toggleDealsSort} className="text-xs" />
                    <SortableHead col="description" label="תיאור" sort={dealsSort ?? { key: '', dir: 'desc' }} onToggle={toggleDealsSort} className="text-xs" />
                    <SortableHead col="net" label="סכום נטו" sort={dealsSort ?? { key: '', dir: 'desc' }} onToggle={toggleDealsSort} className="text-xs" />
                    <SortableHead col="status" label="סטטוס" sort={dealsSort ?? { key: '', dir: 'desc' }} onToggle={toggleDealsSort} className="text-xs" />
                    <SortableHead col="date" label="תאריך" sort={dealsSort ?? { key: '', dir: 'desc' }} onToggle={toggleDealsSort} className="text-xs" />
                    <SortableHead col="kind" label="סוג" sort={dealsSort ?? { key: '', dir: 'desc' }} onToggle={toggleDealsSort} className="text-xs" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dealsRows.map((e) => (
                    <TableRow
                      key={e.id}
                      className={`cursor-pointer hover:bg-purple-50/60 ${loadingTxnId === e.transaction_id ? 'opacity-50' : ''}`}
                      onClick={() => onOpenTransaction(e.transaction_id)}
                    >
                      <TableCell className="text-xs">{e.client_name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[e.position_name, e.candidate_name].filter(Boolean).join(' / ') || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{e.description ?? '—'}</TableCell>
                      <TableCell className="text-xs font-medium">{ILS.format(e.net)}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className={`${STATUS_BADGE[e.status] ?? ''} text-[10px]`}>
                          {STATUS_LABEL[e.status] ?? e.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs"><DateCell value={e._date} /></TableCell>
                      <TableCell className="text-xs">
                        <div className="flex gap-1 items-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${e.kind === 'actual' ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-100 text-purple-700 border-purple-300'}`}
                          >
                            {e.kind === 'actual' ? 'בפועל' : 'תחזית'}
                          </Badge>
                          {e.overdue && (
                            <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-300">
                              באיחור
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-purple-50/50">
                    <TableCell colSpan={3} className="text-xs font-semibold text-purple-800">סה&quot;כ</TableCell>
                    <TableCell colSpan={4} className="text-xs font-semibold text-purple-800">
                      בפועל: {ILS.format(month.actualRevenue)} · צפוי: {ILS.format(month.expectedRevenue)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
          {row.noDateEvents.length > 0 && (
            <div className="rounded-md border">
              <button
                type="button"
                onClick={() => setNoDateOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
              >
                <span>ללא תאריך ({row.noDateEvents.length})</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${noDateOpen ? 'rotate-180' : ''}`} />
              </button>
              {noDateOpen && (
                <div className="divide-y border-t">
                  {row.noDateEvents.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-purple-50/60"
                      onClick={() => onOpenTransaction(e.transaction_id)}
                    >
                      <span className="truncate">{e.client_name ?? '—'} · {[e.position_name, e.candidate_name].filter(Boolean).join(' / ')}</span>
                      <span className="font-medium shrink-0">{ILS.format(e.net)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 6. YTD line */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            בונוסים מצטברים (עד התקופה): <span className="font-semibold text-foreground">{ILS.format(ytdActual)}</span>
            {ytdWithForecast != null && (
              <span className="text-purple-500"> · כולל תחזית: {ILS.format(ytdWithForecast)}</span>
            )}
          </p>

          {/* 5. 12-month stacked chart: actual (solid) + forecast delta (light) */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-600 inline-block" /> בפועל</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-200 inline-block" /> תחזית</span>
          </div>
          <div className="h-32">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip
                  formatter={(v, name) => [ILS.format(Number(v) || 0), name === 'actualBonus' ? 'בפועל' : 'תחזית']}
                  labelFormatter={(label, payload) => {
                    const p = payload?.[0]?.payload as { forecastBonus?: number } | undefined
                    return p ? `${label} · סה"כ תחזית ${ILS.format(p.forecastBonus ?? 0)}` : label
                  }}
                />
                <Bar dataKey="actualBonus" stackId="b" radius={[0, 0, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.key} fill="#7c3aed" stroke={d.key === selectedKey ? '#4c1d95' : undefined} strokeWidth={d.key === selectedKey ? 2 : 0} />
                  ))}
                </Bar>
                <Bar dataKey="forecastDelta" stackId="b" radius={[2, 2, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.key} fill="#c4b5fd" stroke={d.key === selectedKey ? '#4c1d95' : undefined} strokeWidth={d.key === selectedKey ? 2 : 0} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, highlight, forecast, note }: { label: string; value: string; highlight?: boolean; forecast?: boolean; note?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm ${highlight ? 'text-purple-700 font-semibold' : forecast ? 'text-purple-400 font-medium' : 'font-medium'}`}>
        {value}
      </p>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
    </div>
  )
}
