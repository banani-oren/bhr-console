import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Trophy, ChevronLeft, Search, X } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import type { Profile, Transaction } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  computeMonthlyBonusRows, transactionMonth, calculateBonus,
  bonusBreakdown, filterByEmployee,
} from '@/lib/bonus'

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const ROLE_LABELS_HE: Record<string, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

type SortKey = 'name' | 'revenue' | 'bonus'

const TODAY = new Date()

export default function Bonuses() {
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [periodMonth, setPeriodMonth] = useState<number>(TODAY.getMonth() + 1)
  const [periodYear, setPeriodYear] = useState<number>(TODAY.getFullYear())
  const [sortBy, setSortBy] = useState<SortKey>('bonus')

  // 6 months forward (תחזית) + current + 23 months back = 30 entries.
  const monthOptions = useMemo(() => {
    const out: { y: number; m: number; label: string; future: boolean }[] = []
    const todayM = TODAY.getMonth() + 1
    const todayY = TODAY.getFullYear()
    // Start 6 months ahead
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

  // ALL employees (per spec C2.2 — not just bonus_model holders).
  const { data: profiles = [] } = useQuery<Profile[]>({
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

  const { data: txns = [] } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions').select('*')
      if (error) throw error
      return data as Transaction[]
    },
  })

  // Per-employee breakdown for the selected period.
  type Row = {
    profile: Profile
    revenue: number
    bonus: number
    breakdown: ReturnType<typeof bonusBreakdown> | null
    hasModel: boolean
    reachedTier: boolean
  }

  const rows: Row[] = useMemo(() => {
    return profiles.map((p) => {
      if (!p.bonus_model) {
        return {
          profile: p,
          revenue: 0,
          bonus: 0,
          breakdown: null,
          hasModel: false,
          reachedTier: false,
        }
      }
      const filtered = filterByEmployee(txns, p.full_name ?? '').filter((t) => {
        const tm = transactionMonth(t)
        return tm && tm.month === periodMonth && tm.year === periodYear
      })
      const revenue = filtered.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
      const bd = bonusBreakdown(revenue, p.bonus_model.tiers ?? [])
      return {
        profile: p,
        revenue,
        bonus: bd.bonus,
        breakdown: bd,
        hasModel: true,
        reachedTier: bd.tierIndex >= 0 && bd.bonus > 0,
      }
    })
  }, [profiles, txns, periodMonth, periodYear])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let arr = q
      ? rows.filter((r) => (r.profile.full_name ?? '').toLowerCase().includes(q))
      : [...rows]
    arr.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? '', 'he')
        case 'revenue':
          return b.revenue - a.revenue
        case 'bonus':
        default:
          return b.bonus - a.bonus
      }
    })
    return arr
  }, [rows, search, sortBy])

  const totalBonus = filteredRows.reduce((s, r) => s + r.bonus, 0)
  const reachedCount = filteredRows.filter((r) => r.reachedTier).length

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">בונוסים</h1>
      </div>

      {/* Filter bar (spec C2.1) */}
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
              <SelectTrigger><SelectValue /></SelectTrigger>
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
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bonus">בונוס (יורד)</SelectItem>
                <SelectItem value="revenue">הכנסה (יורד)</SelectItem>
                <SelectItem value="name">שם (א-ת)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Cards */}
      {filteredRows.length === 0 ? (
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
              txns={txns}
              onEditModel={() => navigate(`/team?edit=${row.profile.id}`)}
            />
          ))}
        </div>
      )}

      {/* Aggregate footer (spec C2.4) */}
      {filteredRows.length > 0 && (
        <Card className="p-4 bg-purple-50 border-purple-200">
          <div className="flex items-center justify-between text-sm">
            <span className="text-purple-700">
              {filteredRows.length} עובדים · {reachedCount} הגיעו למדרגה
            </span>
            <span className="text-base font-semibold text-purple-900">
              סה"כ בונוסים: {ILS.format(totalBonus)}
            </span>
          </div>
        </Card>
      )}
    </div>
  )
}

function EmployeeCard({
  row,
  periodMonth,
  periodYear,
  txns,
  onEditModel,
}: {
  row: {
    profile: Profile
    revenue: number
    bonus: number
    breakdown: ReturnType<typeof bonusBreakdown> | null
    hasModel: boolean
  }
  periodMonth: number
  periodYear: number
  txns: Transaction[]
  onEditModel: () => void
}) {
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
          <Button
            variant="outline"
            size="sm"
            onClick={onEditModel}
            className="text-purple-700 border-purple-300"
          >
            הגדר מודל <ChevronLeft className="w-3 h-3 ml-1" />
          </Button>
        </CardContent>
      </Card>
    )
  }

  const tiers = row.profile.bonus_model?.tiers ?? []
  const breakdown = row.breakdown!

  // YTD: sum of monthly bonuses for completed months in this calendar year.
  const ytdBonus = (() => {
    let total = 0
    const empTxns = filterByEmployee(txns, row.profile.full_name ?? '')
    for (let m = 1; m <= periodMonth; m++) {
      const monthTxns = empTxns.filter((t) => {
        const tm = transactionMonth(t)
        return tm && tm.year === periodYear && tm.month === m
      })
      const rev = monthTxns.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
      total += calculateBonus(rev, tiers)
    }
    return total
  })()

  const trendData = (() => {
    const empTxns = filterByEmployee(txns, row.profile.full_name ?? '')
    const arr: { month: string; bonus: number; future: boolean }[] = []
    const todayM = new Date().getMonth() + 1
    const todayY = new Date().getFullYear()
    for (let m = 1; m <= 12; m++) {
      const monthTxns = empTxns.filter((t) => {
        const tm = transactionMonth(t)
        return tm && tm.year === periodYear && tm.month === m
      })
      const rev = monthTxns.reduce((s, t) => s + (Number(t.net_invoice_amount) || 0), 0)
      const future = periodYear > todayY || (periodYear === todayY && m > todayM)
      arr.push({ month: HEBREW_MONTHS[m - 1].slice(0, 3), bonus: calculateBonus(rev, tiers), future })
    }
    return arr
  })()

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
          <Button
            variant="outline"
            size="sm"
            onClick={onEditModel}
            className="text-purple-700 border-purple-300"
          >
            ערוך מודל <ChevronLeft className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="הכנסה בתקופה" value={ILS.format(row.revenue)} />
          <Stat
            label="מדרגה נוכחית"
            value={breakdown.currentTier ? ILS.format(breakdown.currentTier.min) : '—'}
          />
          <Stat label="בונוס" value={ILS.format(row.bonus)} highlight />
        </div>
        {breakdown.nextTier ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{ILS.format(breakdown.currentTier?.min ?? 0)}</span>
              <span>{ILS.format(breakdown.nextTier.min)}</span>
            </div>
            <div className="h-2 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-purple-600"
                style={{ width: `${breakdown.progressPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              עוד {ILS.format(breakdown.amountToNext)} למדרגת {ILS.format(breakdown.nextTier.bonus)}
            </p>
          </div>
        ) : breakdown.currentTier ? (
          <p className="text-xs text-muted-foreground">מדרגה מקסימלית</p>
        ) : (
          <p className="text-xs text-muted-foreground">לא הגעת למדרגה הראשונה</p>
        )}
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right text-xs">מינימום (₪)</TableHead>
                <TableHead className="text-right text-xs">בונוס (₪)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers
                .slice()
                .sort((a, b) => a.min - b.min)
                .map((t, i) => (
                  <TableRow key={i} className={breakdown.currentTier?.min === t.min ? 'bg-purple-50' : ''}>
                    <TableCell className="text-xs">{ILS.format(t.min)}</TableCell>
                    <TableCell className="text-xs font-medium">{ILS.format(t.bonus)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            בונוסים מצטברים (עד התקופה): <span className="font-semibold text-foreground">{ILS.format(ytdBonus)}</span>
          </p>
          <div className="h-32">
            <ResponsiveContainer>
              <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip formatter={(v) => ILS.format(Number(v) || 0)} />
                <Bar dataKey="bonus" radius={[2, 2, 0, 0]} fill="#7c3aed"
                  shape={(props: any) => {
                    const fill = props.future ? '#c4b5fd' : '#7c3aed'
                    return <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={fill} rx={2} />
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm ${highlight ? 'text-purple-700 font-semibold' : 'font-medium'}`}>{value}</p>
    </div>
  )
}

// Keep computeMonthlyBonusRows in scope so callers (e.g. BonusWidget) can
// import it elsewhere; this module-level use prevents the bundler from
// tree-shaking it when only this page imports the lib.
void computeMonthlyBonusRows
