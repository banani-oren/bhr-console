import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { jerusalemYearMonth } from '@/lib/finance'
import type { BonusOverview } from '@/lib/bonusOverview'
import type { Transaction } from '@/lib/types'
import TransactionDialog from '@/components/TransactionDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DateCell } from '@/components/ui/date-cell'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Briefcase, Trophy, Clock, CalendarX, Pencil } from 'lucide-react'

// Repair 31 — the recruiter dashboard shows her deals, her hours and a live, HONEST bonus. No
// accounting data: no revenue, amounts, invoices, payments or collection wording (Oren,
// 2026-10-18). The bonus rule is unchanged (Repair 27: a deal counts only when fully paid, at full
// value, in the month of its last payment); only the presentation changed. Numbers come from the
// my-bonus-overview Edge Function (same engine as bonus.ts) — amounts and deal COUNTS only.

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const HE_MONTHS_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ']
const LOCKED = '#7c3aed'
const EXPECTED = '#c4b5fd'

const monthName = (key: string) => HE_MONTHS[Number(key.slice(5)) - 1]
const dealsWord = (n: number) => (n === 1 ? 'עסקה' : 'עסקאות')

const isoMs = (iso: string) => Date.parse(iso + 'T00:00:00Z')
const daysBetween = (fromIso: string, toIso: string) => Math.max(0, Math.round((isoMs(toIso) - isoMs(fromIso)) / 86_400_000))

/** Sunday–Thursday workdays from the 1st of the month up to and including `lastIso` that are not in `have`. */
function missingWorkdays(firstIso: string, lastIso: string, have: Set<string>): number {
  let n = 0
  for (let ms = isoMs(firstIso); ms <= isoMs(lastIso); ms += 86_400_000) {
    const d = new Date(ms)
    const dow = d.getUTCDay() // 0 = Sunday … 6 = Saturday
    if (dow >= 0 && dow <= 4 && !have.has(d.toISOString().slice(0, 10))) n += 1
  }
  return n
}

export default function RecruiterDashboard() {
  const { profile } = useAuth()
  const { year, month, today } = jerusalemYearMonth()
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const firstOfMonth = `${monthKey}-01`
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const overviewQ = useQuery<BonusOverview>({
    queryKey: ['my-bonus-overview', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('my-bonus-overview')
      if (error) throw error
      return data as BonusOverview
    },
  })

  const dealsQ = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_deals')
      if (error) throw error
      return (data as Transaction[] | null) ?? []
    },
  })

  const hoursQ = useQuery<number>({
    queryKey: ['recruiter-hours-month', profile?.id, monthKey],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hours_log')
        .select('hours')
        .eq('profile_id', profile!.id)
        .eq('month', month)
        .eq('year', year)
      if (error) throw error
      return (data ?? []).reduce((s, r) => s + (Number((r as { hours: number | string }).hours) || 0), 0)
    },
  })

  const attendanceQ = useQuery<number>({
    queryKey: ['recruiter-attendance-missing', profile?.id, monthKey, today],
    enabled: !!profile?.id,
    queryFn: async () => {
      if (today <= firstOfMonth) return 0 // nothing to check before the 2nd of the month
      const yesterday = new Date(isoMs(today) - 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('attendance_log')
        .select('work_date')
        .eq('profile_id', profile!.id)
        .gte('work_date', firstOfMonth)
        .lte('work_date', yesterday)
      if (error) throw error
      const have = new Set((data ?? []).map((r) => (r as { work_date: string }).work_date))
      return missingWorkdays(firstOfMonth, yesterday, have)
    },
  })

  const deals = useMemo(() => dealsQ.data ?? [], [dealsQ.data])
  const openDeals = useMemo(
    () =>
      deals
        .filter((d) => !d.close_date)
        .map((d) => ({ deal: d, daysOpen: d.entry_date ? daysBetween(d.entry_date, today) : 0 }))
        .sort((a, b) => b.daysOpen - a.daysOpen),
    [deals, today],
  )
  const closedThisMonth = useMemo(() => deals.filter((d) => (d.close_date ?? '').slice(0, 7) === monthKey).length, [deals, monthKey])

  const ov = overviewQ.data

  // Chart: past months = solid bar; current + future = locked solid + expected light.
  const chartData = useMemo(() => {
    if (!ov) return []
    return ov.months.map((m) => {
      const past = m.month < monthKey
      const mm = Number(m.month.slice(5))
      return {
        label: `${HE_MONTHS_SHORT[mm - 1]} ${m.month.slice(2, 4)}`,
        locked: m.locked_bonus,
        expected: past ? 0 : m.expected_bonus,
        lockedDeals: m.locked_deals_count,
        expectedDeals: past ? 0 : m.expected_deals_count,
      }
    })
  }, [ov, monthKey])

  // "בדרך": expected deals grouped by the month they will count in.
  const onTheWay = useMemo(
    () => (ov ? ov.months.filter((m) => m.month >= monthKey && m.expected_deals_count > 0) : []),
    [ov, monthKey],
  )

  const openAdd = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (t: Transaction) => { setEditing(t); setDialogOpen(true) }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">דשבורד</h1>

      <BonusHero overviewQ={overviewQ} monthKey={monthKey} onTheWay={onTheWay} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="העסקאות הפתוחות שלי" icon={<Briefcase size={18} className="text-purple-600" />} value={dealsQ.isLoading ? '…' : NUM.format(openDeals.length)} testId="kpi-open-deals" />
        <KpiCard title="השמות החודש" icon={<Trophy size={18} className="text-purple-600" />} value={dealsQ.isLoading ? '…' : NUM.format(closedThisMonth)} testId="kpi-closed-month" />
        <KpiCard title="שעות החודש" icon={<Clock size={18} className="text-purple-600" />} value={hoursQ.isLoading ? '…' : (hoursQ.data ?? 0).toFixed(1)} testId="kpi-hours" />
        {(attendanceQ.data ?? 0) > 0 && (
          <Link to="/attendance" className="block" data-testid="kpi-missing-attendance">
            <Card className="h-full border-amber-300 bg-amber-50/60 hover:bg-amber-50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-amber-800">חסרי נוכחות</CardTitle>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
                    <CalendarX size={18} className="text-amber-700" />
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold leading-none text-amber-900">{NUM.format(attendanceQ.data ?? 0)}</p>
                <p className="text-xs text-amber-800/80 mt-1">ימי עבודה החודש ללא דיווח · לדיווח</p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">הבונוס שלי</CardTitle>
        </CardHeader>
        <CardContent>
          {overviewQ.isLoading ? (
            <p className="text-sm text-muted-foreground py-10 text-center">טוען נתונים...</p>
          ) : overviewQ.isError || !ov ? (
            <p className="text-sm text-destructive py-10 text-center">שגיאה בטעינת נתוני הבונוס.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => ILS.format(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
                <Tooltip content={<BonusTooltip />} cursor={{ fill: 'rgba(124,58,237,0.08)' }} />
                <Legend
                  formatter={(v: string) => (v === 'locked' ? 'נעול' : 'צפוי')}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="locked" stackId="b" fill={LOCKED} maxBarSize={40} name="locked" />
                <Bar dataKey="expected" stackId="b" fill={EXPECTED} radius={[4, 4, 0, 0]} maxBarSize={40} name="expected" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">העסקאות הפתוחות שלי</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {dealsQ.isError ? (
            <p className="text-sm text-destructive py-8 text-center">שגיאה בטעינת העסקאות.</p>
          ) : openDeals.length === 0 && !dealsQ.isLoading ? (
            <div className="py-8 text-center space-y-3" data-testid="open-deals-empty">
              <p className="text-muted-foreground">אין עסקאות פתוחות כרגע</p>
              <Button className="bg-purple-600 hover:bg-purple-700 text-white" onClick={openAdd}>פתח עסקה</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right px-4">לקוח</TableHead>
                  <TableHead className="text-right px-4">משרה / מועמד</TableHead>
                  <TableHead className="text-right px-4">נפתחה</TableHead>
                  <TableHead className="text-right px-4">ימים פתוחה</TableHead>
                  <TableHead className="text-right px-4 w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {dealsQ.isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">טוען...</TableCell></TableRow>
                ) : (
                  openDeals.map(({ deal, daysOpen }) => (
                    <TableRow key={deal.id} className="cursor-pointer hover:bg-purple-50/50" onClick={() => openEdit(deal)}>
                      <TableCell className="px-4 font-medium">{deal.client_name}</TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {[deal.position_name, deal.candidate_name].filter(Boolean).join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="px-4"><DateCell value={deal.entry_date} /></TableCell>
                      <TableCell className="px-4">{NUM.format(daysOpen)}</TableCell>
                      <TableCell className="px-4">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-purple-600 hover:bg-purple-100" aria-label="עריכה" onClick={(e) => { e.stopPropagation(); openEdit(deal) }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  )
}

function KpiCard({ title, icon, value, testId }: { title: string; icon: React.ReactNode; value: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">{icon}</span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold leading-none">{value}</p>
      </CardContent>
    </Card>
  )
}

type TooltipPayload = { payload?: { label: string; locked: number; expected: number; lockedDeals: number; expectedDeals: number } }
function BonusTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="rounded-lg border bg-background p-2 text-xs shadow-md" dir="rtl">
      <p className="font-semibold mb-1">{row.label}</p>
      <p><span className="inline-block w-2 h-2 rounded-sm ml-1" style={{ background: LOCKED }} />נעול: {ILS.format(row.locked)} · {NUM.format(row.lockedDeals)} {dealsWord(row.lockedDeals)}</p>
      {(row.expected > 0 || row.expectedDeals > 0) && (
        <p><span className="inline-block w-2 h-2 rounded-sm ml-1" style={{ background: EXPECTED }} />צפוי: {ILS.format(row.expected)} · {NUM.format(row.expectedDeals)} {dealsWord(row.expectedDeals)}</p>
      )}
    </div>
  )
}

function BonusHero({
  overviewQ,
  monthKey,
  onTheWay,
}: {
  overviewQ: { data?: BonusOverview; isLoading: boolean; isError: boolean; refetch: () => unknown }
  monthKey: string
  onTheWay: BonusOverview['months']
}) {
  const ov = overviewQ.data
  if (overviewQ.isLoading) {
    return (
      <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
        <CardContent className="p-6"><p className="text-sm text-muted-foreground">טוען נתונים...</p></CardContent>
      </Card>
    )
  }
  if (overviewQ.isError || !ov) {
    return (
      <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
        <CardContent className="p-6 flex flex-col items-center gap-3">
          <p className="text-sm text-destructive">שגיאה בטעינת נתוני הבונוס.</p>
          <button type="button" onClick={() => void overviewQ.refetch()} className="text-sm text-purple-700 underline">נסה שנית</button>
        </CardContent>
      </Card>
    )
  }

  const { current } = ov
  const noModel = !current.next_tier && current.locked_bonus === 0 && current.expected_this_month.bonus_if_completed === 0 && ov.months.every((m) => m.locked_bonus === 0 && m.expected_bonus === 0)
  const lockedZero = current.locked_bonus === 0

  // Row 1 — "כבר שלך החודש" (locked, always honest: only what Repair 27 has already counted).
  const row1 = (
    <div data-testid="hero-locked" className={lockedZero ? 'opacity-90' : ''}>
      <div className="flex items-center gap-2">
        <p className="text-sm text-purple-800/80">כבר שלך החודש</p>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: LOCKED }}>נעול</span>
      </div>
      <p className={`${lockedZero ? 'text-2xl' : 'text-5xl'} font-bold text-purple-900 mt-1`}>{ILS.format(current.locked_bonus)}</p>
      <p className="text-sm text-purple-700/80 mt-1">{current.locked_deals_count === 1 ? 'עסקה אחת הושלמה' : `${NUM.format(current.locked_deals_count)} עסקאות הושלמו`}</p>
    </div>
  )

  // Row 2 — "בדרך" (expected, light, always labelled; month only — no dates, no payment wording).
  const row2 = (
    <div data-testid="hero-expected" className="space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-purple-900">בדרך</p>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-purple-900" style={{ background: EXPECTED }}>צפוי</span>
      </div>
      {onTheWay.length === 0 ? (
        <p className="text-sm text-purple-900/70">אין עסקאות צפויות להשלמה בחודשים הקרובים.</p>
      ) : (
        onTheWay.map((m) => (
          <p key={m.month} className="text-sm text-purple-900">
            <span className="inline-block w-2.5 h-2.5 rounded-sm ml-1.5 align-middle" style={{ background: EXPECTED }} />
            {m.expected_bonus > 0
              ? `${NUM.format(m.expected_deals_count)} ${dealsWord(m.expected_deals_count)} → בונוס ${monthName(m.month)} צפוי ${ILS.format(m.expected_bonus)}`
              : `${NUM.format(m.expected_deals_count)} ${dealsWord(m.expected_deals_count)} צפויות להשלים ב${monthName(m.month)}`}
          </p>
        ))
      )}
      {ov.pending_unknown_count > 0 && (
        <p className="text-xs text-purple-800/60">
          {NUM.format(ov.pending_unknown_count)} {ov.pending_unknown_count === 1 ? 'עסקה נוספת ממתינה' : 'עסקאות נוספות ממתינות'} — ייכנסו לבונוס כשיושלמו
        </p>
      )}
    </div>
  )

  // Row 3 — "למדרגה הבאה": progress in DEAL units, never a shekel scale.
  const next = current.next_tier
  let row3: React.ReactNode
  if (next) {
    const needed = next.deals_needed ?? 1
    const done = current.locked_deals_count
    const lockedPct = Math.min(100, (done / Math.max(1, done + needed)) * 100)
    const expectedPct = Math.min(100, ((done + current.expected_this_month.deals_count) / Math.max(1, done + needed)) * 100)
    row3 = (
      <div data-testid="hero-next" className="space-y-2">
        <p className="text-sm font-semibold text-purple-900">למדרגה הבאה</p>
        <div className="h-3 w-full rounded-full bg-purple-200/70 overflow-hidden relative" aria-hidden>
          <div className="h-full absolute inset-y-0 right-0 transition-all" style={{ width: `${expectedPct}%`, background: EXPECTED }} />
          <div className="h-full absolute inset-y-0 right-0 transition-all" style={{ width: `${lockedPct}%`, background: LOCKED }} />
        </div>
        <p className="text-sm text-purple-900 font-medium">
          {next.deals_needed == null ? 'עסקה אחת נוספת' : `עוד ${NUM.format(needed)} ${dealsWord(needed)}`} → בונוס {ILS.format(next.bonus)} · נותרו {NUM.format(current.days_left_in_month)} ימים בחודש
        </p>
        {current.expected_this_month.bonus_if_completed > current.locked_bonus && (
          <p className="text-xs text-purple-800">
            אם העסקאות הצפויות החודש יושלמו — הבונוס שלך יעלה ל-{ILS.format(current.expected_this_month.bonus_if_completed)}
          </p>
        )}
      </div>
    )
  } else if (noModel) {
    row3 = <p data-testid="hero-next" className="text-sm text-purple-900/80">המנהל עדיין לא הגדיר מודל בונוס.</p>
  } else {
    row3 = <p data-testid="hero-next" className="text-sm text-purple-900 font-medium">הגעת למדרגה המקסימלית! 🎉</p>
  }

  const rows = lockedZero ? [row3, row2, row1] : [row1, row2, row3]
  void monthKey
  return (
    <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200" data-testid="bonus-hero">
      <CardContent className="p-6 space-y-5">
        {rows.map((r, i) => (<div key={i}>{r}</div>))}
      </CardContent>
    </Card>
  )
}
