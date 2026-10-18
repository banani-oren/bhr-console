import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { jerusalemYearMonth } from '@/lib/finance'
import type { BonusOverview } from '@/lib/bonusOverview'
import UpcomingBonusPanel from '@/components/recruiter/UpcomingBonusPanel'
import type { AttendanceLog, Transaction } from '@/lib/types'
import { buildMonthDays, monthTotals, shiftMonthKey } from '@/lib/attendanceMonth'
import { addCalendarDays, expectedHours } from '@/lib/ilCalendar'
import { formatHours } from '@/lib/attendance'
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
} from 'recharts'
import { Briefcase, Trophy, Clock, CalendarX, CalendarCheck, Check, Pencil } from 'lucide-react'

// Repair 31 — the recruiter dashboard shows her deals, her attendance and a live, HONEST bonus. No
// accounting data: no revenue, amounts, invoices, payments or collection wording (Oren, 2026-10-18).
// The bonus rule is unchanged (Repair 27: a deal counts only when fully paid, at full value, in the
// month of its last payment); numbers come from the my-bonus-overview Edge Function (same engine as
// bonus.ts) — bonus amounts and deal COUNTS only.
//
// Repair 33 (Oren, 2026-10-19): the bonus hero of Repair 32 is replaced by the forward-looking
// UpcomingBonusPanel (components/recruiter) — current month + the next three, counted / expected / estimate.
// Palette = --bonus-* tokens (overrides the purple rule for the recruiter portal only; Admin / Bonuses.tsx keep purple).

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('he-IL')
const HE_MONTHS_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ']
const COUNTED = 'var(--bonus-counted)'

const dealsWord = (n: number) => (n === 1 ? 'עסקה' : 'עסקאות')

const isoMs = (iso: string) => Date.parse(iso + 'T00:00:00Z')
const daysBetween = (fromIso: string, toIso: string) => Math.max(0, Math.round((isoMs(toIso) - isoMs(fromIso)) / 86_400_000))

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
    queryKey: ['transactions', 'mine'], // own cache entry — see Transactions.tsx (Repair 33)
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_deals')
      if (error) throw error
      return (data as Transaction[] | null) ?? []
    },
  })

  // "שעות החודש" = ATTENDANCE hours (Repair 32, D4) — the old card summed hours_log (client hours), which a
  // recruiter who only reports attendance never fills, so it read a bare 0. Same month-days helper as /attendance.
  const attendanceQ = useQuery<AttendanceLog[]>({
    queryKey: ['recruiter-attendance-month', profile?.id, monthKey],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_log')
        .select('*')
        .eq('profile_id', profile!.id)
        .gte('work_date', firstOfMonth)
        .lt('work_date', shiftMonthKey(monthKey, 1) + '-01')
        .order('logged_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as AttendanceLog[]
    },
  })

  const monthDays = useMemo(() => buildMonthDays(monthKey, attendanceQ.data ?? [], today), [attendanceQ.data, monthKey, today])
  const totals = useMemo(() => monthTotals(monthDays), [monthDays])
  const yesterday = addCalendarDays(today, -1)
  const expectedToDate = today > firstOfMonth ? expectedHours(firstOfMonth, yesterday) : 0

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

  // Chart: past months = solid counted; current + future = counted (נספר לבונוס) + striped expected (צפוי) on top.
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

  const openAdd = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (t: Transaction) => { setEditing(t); setDialogOpen(true) }

  const hoursLoading = attendanceQ.isLoading
  const noHours = totals.hours <= 0

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">דשבורד</h1>

      {overviewQ.isLoading ? (
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">טוען נתונים...</p></CardContent></Card>
      ) : overviewQ.isError || !ov ? (
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-3">
            <p className="text-sm text-destructive">שגיאה בטעינת נתוני הבונוס.</p>
            <button type="button" onClick={() => void overviewQ.refetch()} className="text-sm text-purple-700 underline">נסה שנית</button>
          </CardContent>
        </Card>
      ) : (
        <UpcomingBonusPanel ov={ov} onOpenDeal={openAdd} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="העסקאות הפתוחות שלי" icon={<Briefcase size={18} className="text-purple-600" />} value={dealsQ.isLoading ? '…' : NUM.format(openDeals.length)} testId="kpi-open-deals" />
        <KpiCard title="נסגרו החודש" icon={<Trophy size={18} className="text-purple-600" />} value={dealsQ.isLoading ? '…' : NUM.format(closedThisMonth)} testId="kpi-closed-month" />

        <Card data-testid="kpi-hours">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">שעות החודש</CardTitle>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50"><Clock size={18} className="text-purple-600" /></span>
            </div>
          </CardHeader>
          <CardContent>
            {hoursLoading ? (
              <p className="text-2xl font-bold leading-none">…</p>
            ) : attendanceQ.isError ? (
              <p className="text-sm text-destructive">שגיאה בטעינת הנוכחות</p>
            ) : noHours ? (
              <div className="space-y-2">
                <p className="text-sm font-medium" data-testid="kpi-hours-empty">טרם דווחו שעות החודש</p>
                <Link to="/attendance" className="inline-block rounded-md border border-purple-300 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50">לדיווח נוכחות</Link>
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold leading-none">{formatHours(Math.round(totals.hours * 10) / 10)}</p>
                {expectedToDate > 0 && (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="kpi-hours-expected">
                    מתוך {formatHours(expectedToDate)} שעות צפויות עד היום
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ימי נוכחות חסרים — always visible; the link lands on exactly the missing dates (Repair 32 C.2) */}
        <Link
          to={totals.missingDays > 0 ? `/attendance?month=${monthKey}&missing=1` : `/attendance?month=${monthKey}`}
          className="block"
          data-testid="kpi-missing-attendance"
        >
          <Card className={`h-full transition-colors ${totals.missingDays > 0 ? 'border-amber-300 bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-muted/40'}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className={`text-sm font-medium ${totals.missingDays > 0 ? 'text-amber-800' : 'text-muted-foreground'}`}>ימי נוכחות חסרים</CardTitle>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${totals.missingDays > 0 ? 'bg-amber-100' : 'bg-purple-50'}`}>
                  {totals.missingDays > 0 ? <CalendarX size={18} className="text-amber-700" /> : <CalendarCheck size={18} className="text-purple-600" />}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {attendanceQ.isLoading ? (
                <p className="text-2xl font-bold leading-none">…</p>
              ) : totals.missingDays > 0 ? (
                <>
                  <p className="text-2xl font-bold leading-none text-amber-900" data-testid="kpi-missing-count">{NUM.format(totals.missingDays)}</p>
                  <p className="text-xs text-amber-800/80 mt-1">ימי עבודה החודש ללא דיווח · לדיווח</p>
                </>
              ) : (
                <p className="flex items-center gap-1.5 text-base font-semibold" data-testid="kpi-missing-ok">
                  <Check size={18} style={{ color: COUNTED }} aria-hidden /> הכול מדווח
                </p>
              )}
            </CardContent>
          </Card>
        </Link>
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
            <>
              <div className="flex items-center gap-4 text-xs mb-2" data-testid="chart-legend">
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: COUNTED }} />נספר לבונוס</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bonus-stripes" />צפוי</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: 8, bottom: 4 }}>
                  <defs>
                    <pattern id="bonus-expected-stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="8" height="8" style={{ fill: 'var(--bonus-expected-stripe)' }} />
                      <rect width="3" height="8" style={{ fill: 'var(--bonus-expected)' }} />
                    </pattern>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v: number) => ILS.format(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
                  <Tooltip content={<BonusTooltip />} cursor={{ fill: 'rgba(100,100,100,0.08)' }} />
                  <Bar dataKey="locked" stackId="b" fill="var(--bonus-counted)" maxBarSize={40} name="locked" />
                  <Bar dataKey="expected" stackId="b" fill="url(#bonus-expected-stripes)" stroke="var(--bonus-expected)" radius={[4, 4, 0, 0]} maxBarSize={40} name="expected" />
                </BarChart>
              </ResponsiveContainer>
            </>
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
      <p><span className="inline-block w-2 h-2 rounded-sm ml-1" style={{ background: COUNTED }} />נספר לבונוס: {ILS.format(row.locked)} · {NUM.format(row.lockedDeals)} {dealsWord(row.lockedDeals)}</p>
      {(row.expected > 0 || row.expectedDeals > 0) && (
        <p><span className="inline-block w-2 h-2 rounded-sm ml-1 bonus-stripes" />צפוי: {ILS.format(row.expected)} · {NUM.format(row.expectedDeals)} {dealsWord(row.expectedDeals)}</p>
      )}
    </div>
  )
}
