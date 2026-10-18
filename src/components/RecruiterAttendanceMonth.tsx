import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { AttendanceLog } from '@/lib/types'
import { formatHours, formatTime, formatWorkDate, todayIsrael, type AttendancePair } from '@/lib/attendance'
import { buildMonthDays, monthTotals, shiftMonthKey, type MonthDay } from '@/lib/attendanceMonth'
import { STANDARD_WORKDAY_HOURS, EREV_HOLIDAY_HOURS } from '@/lib/workHours'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// Repair 32 (Part D) — a recruiter's own attendance, organised by month (default: the current month,
// earlier months reachable), one row per calendar day so gaps are visible. She may add / correct /
// delete reports ONLY for dates in the current calendar month (Asia/Jerusalem); earlier months are
// read-only. The window is enforced in the database (RLS, 20261020_2_attendance_recruiter_window.sql);
// the UI just doesn't offer what the server would refuse. No amounts anywhere on this view.

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const HE_DAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת']
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Israel wall-clock date+time → ISO instant, independent of the browser's timezone. */
function israelToIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const target = Date.UTC(y, m - 1, d, hh, mm)
  let guess = target
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(guess))
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
    guess += target - wall
  }
  return new Date(guess).toISOString()
}

const timeValue = (iso: string) => formatTime(iso) // HH:MM Israel time

type DialogState = { open: boolean; date: string; pair: AttendancePair | null }

export default function RecruiterAttendanceMonth() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const today = todayIsrael()
  const currentMonth = today.slice(0, 7)

  const rawMonth = params.get('month') ?? ''
  const month = MONTH_RE.test(rawMonth) && rawMonth <= currentMonth ? rawMonth : currentMonth
  const missingOnly = params.get('missing') === '1'
  const isCurrent = month === currentMonth

  // Earliest month with any report — bounds the "previous" arrow.
  const firstQ = useQuery<string | null>({
    queryKey: ['attendance-first-month', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_log').select('work_date').eq('profile_id', profile!.id).order('work_date', { ascending: true }).limit(1)
      if (error) throw error
      return (data?.[0] as { work_date: string } | undefined)?.work_date?.slice(0, 7) ?? null
    },
  })
  const earliest = firstQ.data && firstQ.data < currentMonth ? firstQ.data : currentMonth

  const entriesQ = useQuery<AttendanceLog[]>({
    queryKey: ['recruiter-attendance-month', profile?.id, month],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_log')
        .select('*')
        .eq('profile_id', profile!.id)
        .gte('work_date', `${month}-01`)
        .lt('work_date', shiftMonthKey(month, 1) + '-01')
        .order('logged_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as AttendanceLog[]
    },
  })

  const days = useMemo(() => buildMonthDays(month, entriesQ.data ?? [], today), [entriesQ.data, month, today])
  const totals = useMemo(() => monthTotals(days), [days])
  const visible = missingOnly ? days.filter((d) => d.missing) : days

  const setMonth = (m: string) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev)
      if (m === currentMonth) n.delete('month'); else n.set('month', m)
      return n
    }, { replace: true })
  const setMissing = (on: boolean) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev)
      if (on) n.set('missing', '1'); else n.delete('missing')
      return n
    }, { replace: true })

  const [dlg, setDlg] = useState<DialogState>({ open: false, date: today, pair: null })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['recruiter-attendance-month'] })
    void queryClient.invalidateQueries({ queryKey: ['attendance_today'] })
    void queryClient.invalidateQueries({ queryKey: ['attendance-first-month'] })
  }

  const [y, m] = month.split('-').map(Number)

  return (
    <div className="space-y-4" data-testid="recruiter-attendance-month">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-purple-900">הדיווחים שלי לפי חודש</h2>
        <div className="flex items-center gap-1 mr-auto" dir="rtl">
          {/* RTL: "next" points left, "previous" points right */}
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="חודש קודם" data-testid="month-prev"
            disabled={month <= earliest} onClick={() => setMonth(shiftMonthKey(month, -1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold" data-testid="month-label">{HE_MONTHS[m - 1]} {y}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="חודש הבא" data-testid="month-next"
            disabled={isCurrent} onClick={() => setMonth(shiftMonthKey(month, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        {isCurrent && (
          <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white" data-testid="add-report"
            onClick={() => setDlg({ open: true, date: today, pair: null })}>
            <Plus className="h-4 w-4 ml-1" /> הוספת דיווח
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-xl" data-testid="month-totals">
        <Card className="p-3"><p className="text-xs text-muted-foreground">סה״כ שעות</p><p className="text-xl font-bold" data-testid="total-hours">{formatHours(Math.round(totals.hours * 100) / 100)}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">ימים מדווחים</p><p className="text-xl font-bold" data-testid="total-reported">{totals.reportedDays}</p></Card>
        <Card className={`p-3 ${totals.missingDays > 0 ? 'border-amber-300 bg-amber-50/60' : ''}`}>
          <p className={`text-xs ${totals.missingDays > 0 ? 'text-amber-800' : 'text-muted-foreground'}`}>ימים חסרים</p>
          <p className={`text-xl font-bold ${totals.missingDays > 0 ? 'text-amber-900' : ''}`} data-testid="total-missing">{totals.missingDays}</p>
        </Card>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissing(e.target.checked)} data-testid="missing-filter" />
          הצג רק ימים חסרים
        </label>
        {!isCurrent && <span className="text-xs text-muted-foreground">החודש נסגר — לקריאה בלבד</span>}
      </div>

      {entriesQ.isError ? (
        <p className="text-sm text-destructive py-6 text-center">שגיאה בטעינת הדיווחים.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table data-testid="month-table">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">כניסה</TableHead>
                <TableHead className="text-right">יציאה</TableHead>
                <TableHead className="text-right">סה״כ</TableHead>
                <TableHead className="text-right">הערה</TableHead>
                <TableHead className="text-right">פעולה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entriesQ.isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">טוען...</TableCell></TableRow>
              ) : visible.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground" data-testid="month-empty">
                  {missingOnly ? 'אין ימים חסרים בחודש הזה' : 'אין ימים להצגה'}
                </TableCell></TableRow>
              ) : (
                visible.flatMap((d) => dayRows(d, isCurrent, today, (date, pair) => setDlg({ open: true, date, pair }), refresh))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {dlg.open && (
        <ReportDialog
          key={`${dlg.date}-${dlg.pair?.inEntry.id ?? 'new'}`}
          state={dlg}
          profileId={profile!.id}
          today={today}
          onClose={() => setDlg((s) => ({ ...s, open: false }))}
          onSaved={() => { setDlg((s) => ({ ...s, open: false })); refresh() }}
        />
      )}
    </div>
  )
}

function StatusBadge({ d }: { d: MonthDay }) {
  const weekend = d.weekday >= 5 && !d.holidayName
  if (d.status === 'present') {
    // Friday/Saturday/holiday with a report: show the report, no status (spec D.2).
    if (weekend || d.holidayName) return null
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800"><Check className="h-3 w-3" aria-hidden /> נוכח</span>
  }
  if (d.status === 'missing') return <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900" data-testid="status-missing">{d.hasOpenPair ? 'חסר — חסרה יציאה' : 'חסר'}</span>
  if (d.status === 'holiday') return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">חג{d.holidayName ? ` · ${d.holidayName}` : ''}</span>
  if (d.status === 'erev') return <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">ערב חג{d.isToday ? ' · היום' : ''} · {EREV_HOLIDAY_HOURS} שעות צפויות</span>
  if (d.status === 'future') return <span className="text-xs text-muted-foreground">{d.isToday ? 'היום' : 'עתיד'}</span>
  return null // weekend, nothing reported
}

function dayRows(
  d: MonthDay,
  isCurrent: boolean,
  today: string,
  openDialog: (date: string, pair: AttendancePair | null) => void,
  refresh: () => void,
) {
  const dateCell = (
    <TableCell className="text-right whitespace-nowrap font-medium">
      <span>{HE_DAYS[d.weekday]}</span> <span dir="ltr">{formatWorkDate(d.date).slice(0, 5)}</span>
    </TableCell>
  )
  const rowClass = d.status === 'missing' ? 'bg-amber-50/50' : d.status === 'holiday' || d.status === 'weekend' ? 'bg-muted/30' : ''
  const canReport = isCurrent && d.date <= today && d.status !== 'holiday'

  if (d.pairs.length === 0) {
    return [
      <TableRow key={d.date} className={rowClass} data-testid="day-row" data-date={d.date} data-status={d.status}>
        {dateCell}
        <TableCell className="text-right"><StatusBadge d={d} /></TableCell>
        <TableCell className="text-right text-muted-foreground">—</TableCell>
        <TableCell className="text-right text-muted-foreground">—</TableCell>
        <TableCell className="text-right text-muted-foreground">—</TableCell>
        <TableCell className="text-right" />
        <TableCell className="text-right">
          {d.status === 'missing' && canReport && (
            <Button size="sm" variant="outline" className="h-7 border-amber-400 text-amber-900" data-testid="report-missing" onClick={() => openDialog(d.date, null)}>דיווח נוכחות</Button>
          )}
          {d.status === 'missing' && !isCurrent && (
            <span className="text-xs text-muted-foreground" data-testid="month-closed-note">החודש נסגר — לא ניתן לדווח</span>
          )}
        </TableCell>
      </TableRow>,
    ]
  }
  return d.pairs.map((p, i) => (
    <TableRow key={`${d.date}-${p.inEntry.id}`} className={rowClass} data-testid="day-row" data-date={d.date} data-status={d.status}>
      {i === 0 ? dateCell : <TableCell />}
      <TableCell className="text-right">{i === 0 && <StatusBadge d={d} />}</TableCell>
      <TableCell className="text-right" dir="ltr"><span className="block text-right">{timeValue(p.inEntry.logged_at)}</span></TableCell>
      <TableCell className="text-right" dir="ltr"><span className="block text-right">{p.outEntry ? timeValue(p.outEntry.logged_at) : <span className="text-amber-700" dir="rtl">פתוח</span>}</span></TableCell>
      <TableCell className="text-right">{p.open ? '—' : `${formatHours(Math.round(p.hours * 100) / 100)} ש׳`}</TableCell>
      <TableCell className="text-right max-w-[16rem] truncate" title={p.outEntry?.notes ?? p.inEntry.notes ?? ''}>{p.outEntry?.notes ?? p.inEntry.notes ?? ''}</TableCell>
      <TableCell className="text-right">
        {isCurrent && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-purple-600" aria-label="עריכה" data-testid="edit-pair" onClick={() => openDialog(d.date, p)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <DeletePair pair={p} onDeleted={refresh} />
          </div>
        )}
      </TableCell>
    </TableRow>
  ))
}

function DeletePair({ pair, onDeleted }: { pair: AttendancePair; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const del = async () => {
    setBusy(true)
    setErr(null)
    try {
      const ids = [pair.inEntry.id, pair.outEntry?.id].filter(Boolean) as string[]
      const { error } = await supabase.from('attendance_log').delete().in('id', ids)
      if (error) throw error
      onDeleted()
    } catch {
      setErr('שגיאה במחיקה')
    } finally {
      setBusy(false)
    }
  }
  if (!confirm) {
    return (
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" aria-label="מחיקה" data-testid="delete-pair" onClick={() => setConfirm(true)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-red-600">למחוק?</span>
      <button type="button" disabled={busy} onClick={() => void del()} className="font-medium text-red-600" data-testid="delete-confirm">{busy ? '...' : 'כן'}</button>
      <button type="button" onClick={() => setConfirm(false)} className="text-muted-foreground">ביטול</button>
      {err && <span className="text-red-600">{err}</span>}
    </span>
  )
}

function ReportDialog({
  state, profileId, today, onClose, onSaved,
}: {
  state: DialogState
  profileId: string
  today: string
  onClose: () => void
  onSaved: () => void
}) {
  const editing = state.pair
  const [date, setDate] = useState(state.date)
  const [inTime, setInTime] = useState(editing ? timeValue(editing.inEntry.logged_at) : '09:00')
  const [outTime, setOutTime] = useState(editing?.outEntry ? timeValue(editing.outEntry.logged_at) : editing ? '' : '17:00')
  const [notes, setNotes] = useState(editing?.outEntry?.notes ?? editing?.inEntry.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const monthStart = `${today.slice(0, 7)}-01`

  const save = async () => {
    setError(null)
    if (!date || date < monthStart || date > today) return setError('ניתן לדווח רק על תאריכים מתחילת החודש הנוכחי ועד היום')
    if (!inTime) return setError('יש להזין שעת כניסה')
    if (outTime && outTime <= inTime) return setError('שעת היציאה חייבת להיות אחרי שעת הכניסה')
    if (!editing && !outTime) return setError('יש להזין שעת יציאה')
    setSaving(true)
    try {
      const inIso = israelToIso(date, inTime)
      const outIso = outTime ? israelToIso(date, outTime) : null
      const note = notes.trim().slice(0, 250) || null
      if (editing) {
        const { error: e1 } = await supabase.from('attendance_log').update({ logged_at: inIso }).eq('id', editing.inEntry.id)
        if (e1) throw e1
        if (editing.outEntry && outIso) {
          const { error: e2 } = await supabase.from('attendance_log').update({ logged_at: outIso, notes: note }).eq('id', editing.outEntry.id)
          if (e2) throw e2
        } else if (!editing.outEntry && outIso) {
          const { error: e3 } = await supabase.from('attendance_log').insert({ profile_id: profileId, action: 'check_out', logged_at: outIso, notes: note })
          if (e3) throw e3
        }
      } else {
        const { error: e } = await supabase.from('attendance_log').insert([
          { profile_id: profileId, action: 'check_in', logged_at: inIso },
          { profile_id: profileId, action: 'check_out', logged_at: outIso, notes: note },
        ])
        if (e) throw e
      }
      onSaved()
    } catch (e) {
      console.error('attendance save error:', e)
      setError('השמירה נכשלה — ניתן לדווח רק על החודש הנוכחי. נסה שוב.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent dir="rtl" className="max-w-sm" data-testid="report-dialog">
        <DialogHeader><DialogTitle>{editing ? 'עריכת דיווח נוכחות' : 'דיווח נוכחות'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>תאריך</Label>
            <DateInput value={date} min={monthStart} max={today} disabled={!!editing} onChange={(e) => setDate(e.target.value)} data-testid="report-date" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>כניסה</Label>
              <Input type="time" dir="ltr" value={inTime} onChange={(e) => setInTime(e.target.value)} data-testid="report-in" />
            </div>
            <div className="space-y-1">
              <Label>יציאה</Label>
              <Input type="time" dir="ltr" value={outTime} onChange={(e) => setOutTime(e.target.value)} data-testid="report-out" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>הערה (אופציונלי)</Label>
            <Input maxLength={250} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="תיאור קצר של הפעילות" data-testid="report-notes" />
          </div>
          <p className="text-xs text-muted-foreground">יום עבודה רגיל = {STANDARD_WORKDAY_HOURS} שעות בממוצע. ניתן לדווח ולתקן רק בחודש הנוכחי.</p>
          {error && <p className="text-sm text-red-600" data-testid="report-error">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button>
          <Button className="bg-purple-600 hover:bg-purple-700 text-white" onClick={() => void save()} disabled={saving} data-testid="report-save">
            {saving ? 'שומר...' : 'שמירה'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
