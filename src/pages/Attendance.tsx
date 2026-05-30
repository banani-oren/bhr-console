import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, LogIn, LogOut, CalendarRange } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { AttendanceLog } from '@/lib/types'
import {
  todayIsrael,
  formatTime,
  formatWorkDate,
  computeStatus,
  nextAction,
  dayHours,
  formatHours,
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

type EmployeeOption = { id: string; full_name: string; role: string }

type ReportRow = {
  profileId: string
  name: string
  workDate: string
  checkIns: string[]
  checkOuts: string[]
  hours: number
  open: boolean
}

export default function Attendance() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const today = todayIsrael()
  const canReport = profile?.role === 'admin' || profile?.role === 'administration'

  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

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

  const handleCheck = async () => {
    if (!profile?.id || saving) return
    setSaving(true)
    setFlash(null)
    const { error } = await supabase
      .from('attendance_log')
      .insert({ profile_id: profile.id, action })
    setSaving(false)
    if (error) {
      console.error('attendance insert error:', error)
      setFlash('שגיאה ברישום — נסה שוב')
      return
    }
    setFlash(action === 'check_in' ? '✓ נרשמה כניסה' : '✓ נרשמה יציאה')
    queryClient.invalidateQueries({ queryKey: ['attendance_today', profile.id, today] })
    setTimeout(() => setFlash(null), 2500)
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

        <Button
          onClick={handleCheck}
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
          {todayEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין דיווחים היום.</p>
          ) : (
            <ul className="space-y-1">
              {todayEntries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between text-sm border-b last:border-0 py-1"
                >
                  <span className="flex items-center gap-1.5">
                    {e.action === 'check_in' ? (
                      <LogIn className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5 text-orange-600" />
                    )}
                    {e.action === 'check_in' ? 'כניסה' : 'יציאה'}
                  </span>
                  <span dir="ltr" className="font-medium text-purple-800">
                    {formatTime(e.logged_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ── Report (admin + administration) ────────────────────────────── */}
      {canReport && <AttendanceReport today={today} />}
    </div>
  )
}

function AttendanceReport({ today }: { today: string }) {
  const [employeeId, setEmployeeId] = useState<string>(ALL)
  const [dateFrom, setDateFrom] = useState<string>(today)
  const [dateTo, setDateTo] = useState<string>(today)
  const [submitted, setSubmitted] = useState<{
    employeeId: string
    from: string
    to: string
  } | null>(null)

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

  const { data: reportRows = [], isFetching } = useQuery<ReportRow[]>({
    queryKey: ['attendance_report', submitted],
    enabled: submitted !== null,
    queryFn: async () => {
      let q = supabase
        .from('attendance_log')
        .select('*')
        .gte('work_date', submitted!.from)
        .lte('work_date', submitted!.to)
        .order('work_date', { ascending: false })
        .order('logged_at', { ascending: true })
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

      const out: ReportRow[] = []
      for (const [key, entries] of groups) {
        const [profileId, workDate] = key.split('__')
        const { hours, open } = dayHours(entries)
        out.push({
          profileId,
          name: nameById.get(profileId) ?? '—',
          workDate,
          checkIns: entries
            .filter((e) => e.action === 'check_in')
            .map((e) => formatTime(e.logged_at)),
          checkOuts: entries
            .filter((e) => e.action === 'check_out')
            .map((e) => formatTime(e.logged_at)),
          hours,
          open,
        })
      }
      // Sort by date desc, then employee name asc.
      out.sort(
        (a, b) =>
          b.workDate.localeCompare(a.workDate) ||
          a.name.localeCompare(b.name, 'he'),
      )
      return out
    },
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarRange className="w-5 h-5 text-purple-600" />
        <h2 className="text-lg font-bold text-purple-900">דוח נוכחות</h2>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
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
                  <TableHead className="text-right text-purple-800">כניסות</TableHead>
                  <TableHead className="text-right text-purple-800">יציאות</TableHead>
                  <TableHead className="text-right text-purple-800">סה"כ שעות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportRows.map((r) => (
                  <TableRow key={`${r.profileId}__${r.workDate}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{formatWorkDate(r.workDate)}</TableCell>
                    <TableCell dir="ltr" className="text-right">
                      {r.checkIns.join(', ') || '—'}
                    </TableCell>
                    <TableCell dir="ltr" className="text-right">
                      {r.checkOuts.join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      {r.open ? (
                        <span className="text-amber-600 font-medium">
                          {r.hours > 0 ? `${formatHours(r.hours)} · ` : ''}⚠ פתוח
                        </span>
                      ) : (
                        <span className="font-semibold text-purple-800">
                          {formatHours(r.hours)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
