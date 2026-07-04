import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, LogIn, LogOut, CalendarRange, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { AttendanceLog } from '@/lib/types'
import {
  todayIsrael,
  formatTime,
  formatWorkDateWithDay,
  computeStatus,
  nextAction,
  dayPairs,
  formatHours,
  toLocalInputValue,
  type AttendancePair,
} from '@/lib/attendance'
import { DateInput } from '@/components/ui/date-input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
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

const ALL = '__all__'
const MONTH_ALL = '__all_months__'
const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

type EmployeeOption = { id: string; full_name: string; role: string }

type ReportRow = {
  profileId: string
  name: string
  workDate: string
  pairs: AttendancePair[]
  totalHours: number
  hasOpen: boolean
}

export default function Attendance() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const today = todayIsrael()
  const canReport = profile?.role === 'admin' || profile?.role === 'administration'

  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [checkoutNote, setCheckoutNote] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)

  // ── Today's own entries ────────────────────────────────────────────────
  const { data: todayEntries = [] } = useQuery<AttendanceLog[]>({
    queryKey: ['attendance_today', profile?.id, today],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_log')
        .select('*')
        .eq('profile_id', profile!.id)
        .eq('work_date', today)
        .order('logged_at', { ascending: true })
      if (error) throw error
      return data as AttendanceLog[]
    },
  })

  const status = useMemo(() => computeStatus(todayEntries), [todayEntries])
  const action = nextAction(status)

  // Phase 1: if checking out, show the note input first; check-in saves at once.
  const handleCheckButtonClick = () => {
    if (action === 'check_out') {
      setShowNoteInput(true)
    } else {
      void handleCheck('')
    }
  }

  // Phase 2: actually save.
  const handleCheck = async (notes: string) => {
    if (!profile?.id || saving) return
    setSaving(true)
    setFlash(null)
    const payload: Record<string, unknown> = {
      profile_id: profile.id,
      action,
      ...(notes.trim() ? { notes: notes.trim().slice(0, 250) } : {}),
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error } = await supabase.from('attendance_log').insert(payload).abortSignal(controller.signal)
      if (error) throw error
      setFlash(action === 'check_in' ? '✓ נרשמה כניסה' : '✓ נרשמה יציאה')
      queryClient.invalidateQueries({ queryKey: ['attendance_today', profile.id, today] })
      setTimeout(() => setFlash(null), 2500)
    } catch (err) {
      console.error('attendance insert error:', err)
      setFlash('שגיאה ברישום — נסה שוב')
    } finally {
      clearTimeout(timer)
      setSaving(false)
      setShowNoteInput(false)
      setCheckoutNote('')
    }
  }

  const statusText =
    status.kind === 'in'
      ? `נכנסת ב-${status.since}`
      : status.kind === 'out'
      ? `יצאת ב-${status.since}`
      : 'לא דיווחת היום'

  return (
    <div dir="rtl" className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Clock className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-purple-900">נוכחות</h1>
      </div>

      {/* ── Check-in / out ─────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4 max-w-md">
        <div>
          <p className="text-sm text-muted-foreground">סטטוס נוכחי</p>
          <p className="text-lg font-semibold text-purple-900">{statusText}</p>
        </div>

        {showNoteInput ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-purple-800">מה עשית? (אופציונלי)</p>
            <input
              type="text"
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              placeholder="תיאור קצר של הפעילות (עד 250 תווים)"
              maxLength={250}
              value={checkoutNote}
              onChange={(e) => setCheckoutNote(e.target.value)}
              autoFocus
              dir="rtl"
            />
            <div className="flex gap-2">
              <Button
                onClick={() => void handleCheck(checkoutNote)}
                disabled={saving}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
              >
                <LogOut className="h-4 w-4 ml-1" /> {saving ? 'שומר...' : 'שמור יציאה'}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setShowNoteInput(false); setCheckoutNote('') }}
                disabled={saving}
              >
                ביטול
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={handleCheckButtonClick}
            disabled={saving}
            className={
              action === 'check_in'
                ? 'w-full h-14 text-base bg-green-600 hover:bg-green-700 text-white'
                : 'w-full h-14 text-base bg-orange-600 hover:bg-orange-700 text-white'
            }
          >
            {action === 'check_in' ? (
              <>
                <LogIn className="h-5 w-5 ml-1" /> כניסה
              </>
            ) : (
              <>
                <LogOut className="h-5 w-5 ml-1" /> יציאה
              </>
            )}
          </Button>
        )}

        {flash && (
          <p
            className={
              flash.startsWith('✓')
                ? 'text-green-700 text-sm text-center font-medium'
                : 'text-red-600 text-sm text-center'
            }
          >
            {flash}
          </p>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium text-purple-700">הדיווחים שלי היום</p>
          {(() => {
            const pairs = dayPairs(todayEntries)
            if (pairs.length === 0)
              return <p className="text-xs text-muted-foreground">אין דיווחים היום.</p>
            return (
              <ul className="space-y-2">
                {pairs.map((pair) => (
                  <li
                    key={pair.inEntry.id}
                    className="border rounded-md p-2 space-y-1 bg-muted/20"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1 text-green-700">
                        <LogIn className="h-3.5 w-3.5" />
                        <span dir="ltr">{formatTime(pair.inEntry.logged_at)}</span>
                      </span>
                      <span className="text-muted-foreground text-xs mx-1">→</span>
                      {pair.outEntry ? (
                        <span className="flex items-center gap-1 text-orange-700">
                          <LogOut className="h-3.5 w-3.5" />
                          <span dir="ltr">{formatTime(pair.outEntry.logged_at)}</span>
                        </span>
                      ) : (
                        <span className="text-amber-600 text-xs">פתוח</span>
                      )}
                      <span className="text-purple-800 font-semibold text-xs mr-auto ml-2">
                        {pair.open ? '' : formatHours(pair.hours) + 'ש\''}
                      </span>
                      <RequestEditButton
                        entry={pair.outEntry ?? pair.inEntry}
                        profileId={profile!.id}
                        onSubmitted={() => {/* no invalidation needed for today view */}}
                      />
                    </div>
                    {pair.outEntry?.notes && (
                      <p className="text-xs text-muted-foreground truncate">{pair.outEntry.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      </Card>

      {/* ── Admin pending edit requests ────────────────────────────────── */}
      {profile?.role === 'admin' && <PendingEditRequests />}

      {/* ── Report (admin + administration) ────────────────────────────── */}
      {canReport && <AttendanceReport today={today} />}
    </div>
  )
}

// ── Employee edit-request button + inline form ──────────────────────────
function RequestEditButton({
  entry,
  profileId,
  onSubmitted,
}: {
  entry: AttendanceLog
  profileId: string
  onSubmitted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [proposedTime, setProposedTime] = useState(toLocalInputValue(entry.logged_at))
  const [proposedNotes, setProposedNotes] = useState(entry.notes ?? '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        className="text-[10px] text-muted-foreground hover:text-purple-600 border border-muted rounded px-1 py-0.5"
        onClick={() => setOpen(true)}
        title="בקש תיקון"
      >
        תיקון
      </button>
    )
  }

  const handleSubmit = async () => {
    if (!reason.trim()) return
    setSaving(true)
    setError(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error: reqError } = await supabase.from('attendance_edit_requests').insert({
        attendance_log_id: entry.id,
        profile_id: profileId,
        proposed_logged_at: new Date(proposedTime).toISOString(),
        proposed_notes: proposedNotes.trim() || null,
        reason: reason.trim(),
      }).abortSignal(controller.signal)
      if (reqError) throw reqError
      setOpen(false)
      onSubmitted()
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setError(isTimeout ? 'השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.' : 'שגיאה בשליחת הבקשה')
    } finally {
      clearTimeout(timer)
      setSaving(false)
    }
  }

  return (
    <div className="border rounded-md p-2 space-y-1.5 bg-purple-50/40 text-xs w-64">
      <p className="font-medium text-purple-800">בקשת תיקון</p>
      <div>
        <label className="text-muted-foreground">זמן מוצע</label>
        <input
          type="datetime-local"
          className="w-full border rounded px-2 py-1 text-xs mt-0.5"
          value={proposedTime}
          onChange={(e) => setProposedTime(e.target.value)}
          dir="ltr"
        />
      </div>
      {entry.action === 'check_out' && (
        <div>
          <label className="text-muted-foreground">תיאור מוצע</label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1 text-xs mt-0.5"
            maxLength={250}
            value={proposedNotes}
            onChange={(e) => setProposedNotes(e.target.value)}
            dir="rtl"
          />
        </div>
      )}
      <div>
        <label className="text-muted-foreground">סיבה לתיקון *</label>
        <input
          type="text"
          className="w-full border rounded px-2 py-1 text-xs mt-0.5"
          maxLength={250}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          dir="rtl"
          placeholder="חובה — הסבר מדוע"
        />
      </div>
      {error && <p className="text-red-600 text-[11px] text-right" dir="rtl">{error}</p>}
      <div className="flex gap-1">
        <button
          type="button"
          disabled={saving || !reason.trim()}
          onClick={() => void handleSubmit()}
          className="flex-1 bg-purple-600 text-white rounded px-2 py-1 disabled:opacity-50"
        >
          {saving ? '...' : 'שלח'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 py-1 border rounded text-muted-foreground"
        >
          ביטול
        </button>
      </div>
    </div>
  )
}

// ── Admin direct-edit button + inline form ──────────────────────────────
function AdminEditButton({
  pair,
  onSaved,
}: {
  pair: AttendancePair
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [inTime, setInTime] = useState(toLocalInputValue(pair.inEntry.logged_at))
  const [inNotes, setInNotes] = useState(pair.inEntry.notes ?? '')
  const [outTime, setOutTime] = useState(
    pair.outEntry ? toLocalInputValue(pair.outEntry.logged_at) : '',
  )
  const [outNotes, setOutNotes] = useState(pair.outEntry?.notes ?? '')
  const [addingOut, setAddingOut] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        className="text-muted-foreground hover:text-purple-600"
        onClick={() => setOpen(true)}
        title="ערוך"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    )
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error: e1 } = await supabase
        .from('attendance_log')
        .update({ logged_at: new Date(inTime).toISOString(), notes: inNotes.trim() || null })
        .eq('id', pair.inEntry.id)
        .abortSignal(controller.signal)
      if (e1) throw e1

      if (pair.outEntry) {
        if (outTime) {
          const { error: e2 } = await supabase
            .from('attendance_log')
            .update({ logged_at: new Date(outTime).toISOString(), notes: outNotes.trim() || null })
            .eq('id', pair.outEntry.id)
            .abortSignal(controller.signal)
          if (e2) throw e2
        }
      } else if (addingOut && outTime) {
        const { error: e3 } = await supabase
          .from('attendance_log')
          .insert({
            profile_id: pair.inEntry.profile_id,
            action: 'check_out',
            logged_at: new Date(outTime).toISOString(),
            notes: outNotes.trim() || null,
          })
          .abortSignal(controller.signal)
        if (e3) throw e3
      }

      setOpen(false)
      onSaved()
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setError(isTimeout ? 'השמירה לא הושלמה — פג זמן. בדוק חיבור לאינטרנט ונסה שנית.' : 'שגיאה בשמירה')
    } finally {
      clearTimeout(timer)
      setSaving(false)
    }
  }

  return (
    <div className="border rounded-md p-2 space-y-1.5 bg-amber-50/40 text-xs w-64">
      <p className="font-medium text-amber-800">עריכת רשומה (אדמין)</p>
      <div>
        <label className="text-green-700 font-medium">כניסה</label>
        <input type="datetime-local" className="w-full border rounded px-2 py-1 text-xs mt-0.5" value={inTime} onChange={(e) => setInTime(e.target.value)} dir="ltr" />
        <input type="text" placeholder="הערות (אופציונלי)" className="w-full border rounded px-2 py-1 text-xs mt-0.5" maxLength={250} value={inNotes} onChange={(e) => setInNotes(e.target.value)} dir="rtl" />
      </div>
      {pair.outEntry || addingOut ? (
        <div>
          <label className="text-orange-700 font-medium">יציאה</label>
          <input type="datetime-local" className="w-full border rounded px-2 py-1 text-xs mt-0.5" value={outTime} onChange={(e) => setOutTime(e.target.value)} dir="ltr" />
          <input type="text" placeholder="הערות יציאה (אופציונלי)" className="w-full border rounded px-2 py-1 text-xs mt-0.5" maxLength={250} value={outNotes} onChange={(e) => setOutNotes(e.target.value)} dir="rtl" />
        </div>
      ) : (
        <button type="button" onClick={() => setAddingOut(true)} className="text-purple-700 underline">
          + הוסף יציאה
        </button>
      )}
      {error && <p className="text-red-600 text-[11px] text-right" dir="rtl">{error}</p>}
      <div className="flex gap-1">
        <button type="button" disabled={saving} onClick={() => void handleSave()} className="flex-1 bg-amber-600 text-white rounded px-2 py-1 disabled:opacity-50">
          {saving ? '...' : 'שמור'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 border rounded text-muted-foreground">ביטול</button>
      </div>
    </div>
  )
}

// ── Admin delete button (two-step inline confirm) ───────────────────────
function AdminDeleteButton({
  pair,
  onDeleted,
}: {
  pair: AttendancePair
  onDeleted: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    const ids = [pair.inEntry.id, pair.outEntry?.id].filter(Boolean) as string[]
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error: delError } = await supabase
        .from('attendance_log')
        .delete()
        .in('id', ids)
        .abortSignal(controller.signal)
      if (delError) throw delError
      onDeleted()
    } catch (err) {
      console.error('attendance delete error:', err)
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      setError(isTimeout ? 'פג זמן — נסה שנית' : 'שגיאה במחיקה')
    } finally {
      clearTimeout(timer)
      setDeleting(false)
    }
  }

  if (!confirm) {
    return (
      <button
        type="button"
        className="text-muted-foreground hover:text-red-500 transition-colors"
        onClick={() => setConfirm(true)}
        title="מחק רשומה"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-red-600">מחק?</span>
      <button
        type="button"
        disabled={deleting}
        onClick={() => void handleDelete()}
        className="text-red-600 hover:text-red-800 font-medium"
      >
        {deleting ? '...' : 'כן'}
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        className="text-muted-foreground hover:text-foreground"
      >
        ביטול
      </button>
      {error && <span className="text-red-600 text-[11px]">{error}</span>}
    </div>
  )
}

function AttendanceReport({ today }: { today: string }) {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = profile?.role === 'admin'

  const [todayY, todayM] = today.split('-').map(Number)
  const currentMonthKey = `${todayY}-${String(todayM).padStart(2, '0')}`
  const currentMonthFrom = `${currentMonthKey}-01`

  const [employeeId, setEmployeeId] = useState<string>(ALL)
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey)
  const [dateFrom, setDateFrom] = useState<string>(currentMonthFrom)
  const [dateTo, setDateTo] = useState<string>(today)
  const [submitted, setSubmitted] = useState<{
    employeeId: string
    from: string
    to: string
  } | null>({ employeeId: ALL, from: currentMonthFrom, to: today })

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    for (let i = 0; i < 12; i++) {
      let y = todayY
      let m = todayM - i
      while (m <= 0) { m += 12; y -= 1 }
      opts.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${HE_MONTHS[m - 1]} ${y}` })
    }
    return opts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  const handleMonthChange = (value: string | null) => {
    const v = value || MONTH_ALL
    setMonthKey(v)
    if (v === MONTH_ALL) {
      setDateFrom('')
      setDateTo('')
    } else {
      const [y, m] = v.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      setDateFrom(`${v}-01`)
      setDateTo(`${v}-${String(lastDay).padStart(2, '0')}`)
    }
  }

  const { data: employees = [] } = useQuery<EmployeeOption[]>({
    queryKey: ['attendance_employees'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_profiles_for_attendance')
      if (error) throw error
      return (data as EmployeeOption[]) ?? []
    },
  })

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of employees) m.set(e.id, e.full_name)
    return m
  }, [employees])

  // Name resolution is intentionally NOT done inside queryFn: the report now
  // fires on mount alongside the employees query, so nameById may still be
  // empty when this queryFn runs. Baking '—' into the cached result would
  // never self-correct once employees finishes loading (same queryKey ⇒ no
  // re-run). Names are resolved reactively below via a plain useMemo instead.
  const { data: reportRowsRaw = [], isFetching } = useQuery<Omit<ReportRow, 'name'>[]>({
    queryKey: ['attendance_report', submitted],
    enabled: submitted !== null,
    queryFn: async () => {
      let q = supabase
        .from('attendance_log')
        .select('*')
        .order('work_date', { ascending: false })
        .order('logged_at', { ascending: true })
      if (submitted!.from) q = q.gte('work_date', submitted!.from)
      if (submitted!.to) q = q.lte('work_date', submitted!.to)
      if (submitted!.employeeId !== ALL) q = q.eq('profile_id', submitted!.employeeId)
      const { data, error } = await q
      if (error) throw error
      const rows = (data as AttendanceLog[]) ?? []

      // Group by (profile_id, work_date).
      const groups = new Map<string, AttendanceLog[]>()
      for (const r of rows) {
        const key = `${r.profile_id}__${r.work_date}`
        const arr = groups.get(key) ?? []
        arr.push(r)
        groups.set(key, arr)
      }

      const out: Omit<ReportRow, 'name'>[] = []
      for (const [key, entries] of groups) {
        const [profileId, workDate] = key.split('__')
        const pairs = dayPairs(entries)
        const totalHours = pairs.reduce((s, p) => s + p.hours, 0)
        const hasOpen = pairs.some((p) => p.open)
        out.push({ profileId, workDate, pairs, totalHours, hasOpen })
      }
      return out
    },
  })

  const reportRows = useMemo(() => {
    const withNames: ReportRow[] = reportRowsRaw.map((r) => ({
      ...r,
      name: nameById.get(r.profileId) ?? '—',
    }))
    // Sort by date desc, then employee name asc.
    withNames.sort(
      (a, b) =>
        b.workDate.localeCompare(a.workDate) ||
        a.name.localeCompare(b.name, 'he'),
    )
    return withNames
  }, [reportRowsRaw, nameById])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarRange className="w-5 h-5 text-purple-600" />
        <h2 className="text-lg font-bold text-purple-900">דוח נוכחות</h2>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">עובד</Label>
            <Select value={employeeId} onValueChange={(v) => setEmployeeId(v || ALL)}>
              <SelectTrigger>
                <span className="truncate text-sm">
                  {employeeId === ALL ? 'כל העובדים' : nameById.get(employeeId) ?? '—'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>כל העובדים</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">בחר חודש</Label>
            <Select value={monthKey} onValueChange={handleMonthChange}>
              <SelectTrigger>
                <span className="truncate text-sm">
                  {monthKey === MONTH_ALL
                    ? 'הכל'
                    : monthOptions.find((o) => o.value === monthKey)?.label ?? monthKey}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MONTH_ALL}>הכל</SelectItem>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">מתאריך</Label>
            <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">עד תאריך</Label>
            <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <Button
            onClick={() => setSubmitted({ employeeId, from: dateFrom, to: dateTo })}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            הפק דוח
          </Button>
        </div>
      </Card>

      {submitted && (
        <Card className="p-0 overflow-hidden">
          {isFetching ? (
            <p className="text-sm text-muted-foreground p-6 text-center">טוען...</p>
          ) : reportRows.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">
              אין נתוני נוכחות לטווח שנבחר.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right text-purple-800">שם עובד</TableHead>
                  <TableHead className="text-right text-purple-800">תאריך</TableHead>
                  <TableHead className="text-right text-purple-800">כניסה</TableHead>
                  <TableHead className="text-right text-purple-800">יציאה</TableHead>
                  <TableHead className="text-right text-purple-800">שעות</TableHead>
                  <TableHead className="text-right text-purple-800">תיאור</TableHead>
                  {isAdmin && <TableHead className="text-right text-purple-800">פעולות</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportRows.flatMap((r) =>
                  r.pairs.length === 0 ? [] : r.pairs.map((pair, pi) => (
                    <TableRow key={`${r.profileId}__${r.workDate}__${pi}`}>
                      <TableCell className="font-medium">{pi === 0 ? r.name : ''}</TableCell>
                      <TableCell className="whitespace-nowrap">{pi === 0 ? formatWorkDateWithDay(r.workDate) : ''}</TableCell>
                      <TableCell dir="ltr" className="text-right text-green-700 font-medium">
                        {formatTime(pair.inEntry.logged_at)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-right text-orange-700 font-medium">
                        {pair.outEntry ? formatTime(pair.outEntry.logged_at) : (
                          <span className="text-amber-600 text-xs">פתוח</span>
                        )}
                      </TableCell>
                      <TableCell className="text-purple-800 font-semibold">
                        {pair.open ? (
                          <span className="text-amber-600">⚠ פתוח</span>
                        ) : formatHours(pair.hours)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-48 truncate">
                        {pair.outEntry?.notes ?? '—'}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <AdminEditButton
                              pair={pair}
                              onSaved={() => queryClient.invalidateQueries({ queryKey: ['attendance_report'] })}
                            />
                            <AdminDeleteButton
                              pair={pair}
                              onDeleted={() => queryClient.invalidateQueries({ queryKey: ['attendance_report'] })}
                            />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}

// ── Admin: pending edit requests ────────────────────────────────────────
function PendingEditRequests() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const { data: requests = [], isFetching } = useQuery({
    queryKey: ['attendance_edit_requests_pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_edit_requests')
        .select(`*, attendance_log(*), profiles!attendance_edit_requests_profile_id_fkey(full_name)`)
        .eq('status', 'pending')
        .order('requested_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })

  const handleDecision = async (
    id: string,
    approve: boolean,
    logEntry: AttendanceLog,
    req: { proposed_logged_at: string; proposed_notes: string | null },
  ) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      if (approve) {
        const { error: logErr } = await supabase.from('attendance_log')
          .update({ logged_at: req.proposed_logged_at, notes: req.proposed_notes })
          .eq('id', logEntry.id)
          .abortSignal(controller.signal)
        if (logErr) throw logErr
      }
      const { error: reqErr } = await supabase.from('attendance_edit_requests')
        .update({
          status: approve ? 'approved' : 'rejected',
          reviewed_by: profile?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .abortSignal(controller.signal)
      if (reqErr) throw reqErr
      queryClient.invalidateQueries({ queryKey: ['attendance_edit_requests_pending'] })
      queryClient.invalidateQueries({ queryKey: ['attendance_today'] })
      queryClient.invalidateQueries({ queryKey: ['attendance_report'] })
    } catch (err) {
      console.error('attendance decision error:', err)
    } finally {
      clearTimeout(timer)
    }
  }

  if (isFetching) return null
  if (requests.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-amber-800">בקשות תיקון ממתינות ({requests.length})</h2>
      </div>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right text-purple-800">עובד</TableHead>
              <TableHead className="text-right text-purple-800">זמן נוכחי</TableHead>
              <TableHead className="text-right text-purple-800">זמן מוצע</TableHead>
              <TableHead className="text-right text-purple-800">סיבה</TableHead>
              <TableHead className="text-right text-purple-800">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((req: Record<string, unknown>) => {
              const log = req.attendance_log as AttendanceLog
              const employeeName = (req.profiles as { full_name: string } | null)?.full_name ?? '—'
              return (
                <TableRow key={String(req.id)}>
                  <TableCell className="font-medium">{employeeName}</TableCell>
                  <TableCell dir="ltr" className="text-right">{log ? formatTime(log.logged_at) : '—'}</TableCell>
                  <TableCell dir="ltr" className="text-right font-medium text-purple-700">
                    {formatTime(String(req.proposed_logged_at))}
                    {req.proposed_notes ? <span className="block text-xs text-muted-foreground">{String(req.proposed_notes)}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48">{String(req.reason)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white text-xs px-2"
                        onClick={() => void handleDecision(String(req.id), true, log, { proposed_logged_at: String(req.proposed_logged_at), proposed_notes: req.proposed_notes as string | null })}>
                        אשר
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-300 hover:bg-red-50 text-xs px-2"
                        onClick={() => void handleDecision(String(req.id), false, log, { proposed_logged_at: String(req.proposed_logged_at), proposed_notes: req.proposed_notes as string | null })}>
                        דחה
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
