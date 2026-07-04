import { useEffect, useMemo, useState } from 'react'
import { DateInput } from '@/components/ui/date-input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, WifiOff, RefreshCw, ChevronRight, ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Client, HoursLog as HoursLogType } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import ClientPicker from '@/components/ClientPicker'
import { enqueueHoursEntry, readQueue, removeFromQueue } from '@/lib/offlineQueue'
import { formatWorkDateWithDay } from '@/lib/attendance'

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

function computeHours(start: string, end: string): number | null {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) return null
  return Math.round((mins / 60) * 100) / 100
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function MobileHours() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = profile?.role === 'admin'
  const now = new Date()

  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HoursLogType | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string>('')
  const [visitDate, setVisitDate] = useState(today())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)

  const refreshPending = async () => setPendingCount(await (await readQueue()).length)
  useEffect(() => {
    refreshPending()
  }, [])

  const goMonth = (delta: number) => {
    let m = month + delta
    let y = year
    while (m > 12) { m -= 12; y += 1 }
    while (m < 1) { m += 12; y -= 1 }
    setMonth(m)
    setYear(y)
  }

  const { data: permittedClients = [] } = useQuery<Client[]>({
    queryKey: ['permitted-clients', profile?.id, isAdmin],
    enabled: !!profile?.id,
    queryFn: async () => {
      if (isAdmin) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('time_log_enabled', true)
          .order('name', { ascending: true })
        if (error) throw error
        return (data as Client[]) ?? []
      }
      const { data, error } = await supabase
        .from('client_time_log_permissions')
        .select('client_id, clients(*)')
        .eq('profile_id', profile!.id)
      if (error) throw error
      const rows = (data as unknown as Array<{ clients: Client | Client[] | null }> | null) ?? []
      return rows
        .flatMap((r) => (Array.isArray(r.clients) ? r.clients : r.clients ? [r.clients] : []))
        .filter((c) => c && c.time_log_enabled)
    },
  })

  const { data: entries = [] } = useQuery<HoursLogType[]>({
    queryKey: ['m-hours_log', profile?.id, month, year],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hours_log')
        .select('*')
        .eq('profile_id', profile!.id)
        .eq('month', month)
        .eq('year', year)
        .order('visit_date', { ascending: false })
      if (error) throw error
      return data as HoursLogType[]
    },
  })

  const groups = useMemo(() => {
    const g = new Map<string, HoursLogType[]>()
    for (const e of entries) {
      const key = e.visit_date
      const arr = g.get(key) ?? []
      arr.push(e)
      g.set(key, arr)
    }
    return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries])

  const summary = useMemo(() => {
    const totalHours = entries.reduce((sum, e) => sum + (e.hours || 0), 0)
    return { totalHours, sessions: entries.length }
  }, [entries])

  const computed = computeHours(startTime, endTime)

  const resetForm = () => {
    setEditingId(null)
    setClientId(null)
    setClientName('')
    setVisitDate(today())
    setStartTime('09:00')
    setEndTime('')
    setDescription('')
    setError(null)
  }

  const openAdd = () => {
    resetForm()
    setSheetOpen(true)
  }

  const openEdit = (entry: HoursLogType) => {
    setEditingId(entry.id)
    setClientId(entry.client_id)
    setClientName(entry.client_name)
    setVisitDate(entry.visit_date)
    setStartTime(entry.start_time ?? '09:00')
    setEndTime(entry.end_time ?? '')
    setDescription(entry.description ?? '')
    setError(null)
    setSheetOpen(true)
  }

  const handleSave = async () => {
    if (!clientId || !startTime || !endTime || !profile) return
    const visit = new Date(visitDate)
    const payload: Record<string, unknown> = {
      client_id: clientId,
      client_name: clientName,
      visit_date: visitDate,
      start_time: startTime,
      end_time: endTime,
      hours: computeHours(startTime, endTime) ?? 0,
      description: description || null,
      month: visit.getMonth() + 1,
      year: visit.getFullYear(),
      profile_id: profile.id,
    }
    setSaving(true)
    setError(null)
    try {
      if (!editingId && !navigator.onLine) {
        await enqueueHoursEntry(payload)
        await refreshPending()
        setSheetOpen(false)
        resetForm()
        return
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
      try {
        if (editingId) {
          const { error: updErr } = await supabase
            .from('hours_log')
            .update(payload)
            .eq('id', editingId)
            .abortSignal(controller.signal)
          if (updErr) throw updErr
        } else {
          const { error: insErr } = await supabase.from('hours_log').insert(payload).abortSignal(controller.signal)
          if (insErr) throw insErr
        }
      } finally {
        clearTimeout(timeout)
      }
      queryClient.invalidateQueries({ queryKey: ['m-hours_log'] })
      queryClient.invalidateQueries({ queryKey: ['hours_log'] })
      setSheetOpen(false)
      resetForm()
    } catch (err) {
      if (!editingId && !navigator.onLine) {
        await enqueueHoursEntry(payload)
        await refreshPending()
        setSheetOpen(false)
        resetForm()
        return
      }
      console.error('mobile hours save error:', err)
      setError(err instanceof Error ? err.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
    try {
      const { error: delErr } = await supabase
        .from('hours_log')
        .delete()
        .eq('id', deleteTarget.id)
        .abortSignal(controller.signal)
      if (delErr) throw delErr
      queryClient.invalidateQueries({ queryKey: ['m-hours_log'] })
      queryClient.invalidateQueries({ queryKey: ['hours_log'] })
      setDeleteTarget(null)
      setExpandedId(null)
    } catch (err) {
      console.error('mobile hours delete error:', err)
      setError(err instanceof Error ? err.message : 'שגיאה במחיקה')
    } finally {
      clearTimeout(timeout)
      setDeleting(false)
    }
  }

  const flushQueue = async () => {
    if (!navigator.onLine) return
    const queue = await readQueue()
    let flushed = 0
    for (const item of queue) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
      let error: unknown = null
      try {
        const res = await supabase.from('hours_log').insert(item.payload).abortSignal(controller.signal)
        error = res.error
      } catch (err) {
        error = err
      } finally {
        clearTimeout(timer)
      }
      if (!error) {
        await removeFromQueue(item.id)
        flushed += 1
      }
    }
    await refreshPending()
    if (flushed > 0) {
      queryClient.invalidateQueries({ queryKey: ['m-hours_log'] })
    }
  }

  return (
    <div className="p-4 space-y-3 pb-24">
      <Card className="p-3 flex flex-row items-center justify-between bg-purple-50 border-purple-100">
        <button onClick={() => goMonth(-1)} className="p-2 text-purple-700" aria-label="חודש קודם">
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="font-semibold text-purple-900">שעות עבודה</p>
          <p className="text-xs text-purple-600">{HE_MONTHS[month - 1]} {year}</p>
        </div>
        <button onClick={() => goMonth(1)} className="p-2 text-purple-700" aria-label="חודש הבא">
          <ChevronLeft className="h-5 w-5" />
        </button>
      </Card>

      <Card className="p-3 flex flex-row items-center justify-around text-center">
        <div>
          <p className="text-xl font-bold text-purple-900">{summary.totalHours}</p>
          <p className="text-[11px] text-muted-foreground">סה"כ שעות</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-xl font-bold text-purple-900">{summary.sessions}</p>
          <p className="text-[11px] text-muted-foreground">דיווחים</p>
        </div>
      </Card>

      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs flex items-center justify-between">
          <span className="flex items-center gap-1 text-amber-800">
            <WifiOff className="h-3 w-3" />
            {pendingCount} דיווחים ממתינים לסנכרון
          </span>
          <button
            onClick={flushQueue}
            className="text-amber-700 hover:underline flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> נסה שוב
          </button>
        </div>
      )}

      <div className="space-y-3">
        {groups.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            אין דיווחים בחודש זה.
          </Card>
        ) : (
          groups.map(([date, rows]) => (
            <Card key={date} className="p-3 space-y-2">
              <p className="text-xs font-medium text-purple-700">{formatWorkDateWithDay(date)}</p>
              <div className="space-y-1">
                {rows.map((r) => {
                  const billed = !!r.billed_transaction_id
                  const expanded = expandedId === r.id
                  return (
                    <div key={r.id} className="border-b last:border-0 py-1.5">
                      <button
                        className="w-full flex items-center justify-between text-sm text-right"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                      >
                        <div className="min-w-0">
                          <p className="font-medium flex items-center gap-1.5">
                            {r.client_name}
                            {billed && (
                              <Badge variant="outline" className="text-green-700 border-green-300 text-[9px]">
                                חויב ✓
                              </Badge>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            <span dir="ltr">
                              {(r.start_time ?? '—')} → {(r.end_time ?? '—')}
                            </span>
                            {!expanded && r.description ? ` · ${r.description}` : ''}
                          </p>
                        </div>
                        <span className="text-purple-700 font-semibold text-sm shrink-0 ms-2">{r.hours} ש'</span>
                      </button>
                      {expanded && (
                        <div className="mt-2 space-y-2">
                          {r.description && (
                            <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
                              {r.description}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              disabled={billed}
                              title={billed ? 'נעול — חויב' : 'עריכה'}
                              onClick={() => openEdit(r)}
                            >
                              <Pencil className="h-3.5 w-3.5 ml-1" /> עריכה
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                              disabled={billed}
                              title={billed ? 'נעול — חויב' : 'מחיקה'}
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 className="h-3.5 w-3.5 ml-1" /> מחיקה
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          ))
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => setDeleteTarget(null)}>
          <Card className="w-full rounded-b-none p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-center">
              למחוק את הדיווח של <span className="font-medium">{deleteTarget.client_name}</span>?
            </p>
            {error && <p className="text-xs text-red-600 text-center">{error}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'מוחק...' : 'כן, מחק'}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                ביטול
              </Button>
            </div>
          </Card>
        </div>
      )}

      <button
        onClick={openAdd}
        className="fixed bottom-20 left-4 z-30 flex items-center justify-center w-14 h-14 rounded-full bg-purple-700 hover:bg-purple-800 text-white shadow-lg active:scale-95 transition-transform"
        aria-label="דווח שעות"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl" dir="rtl">
          <SheetHeader>
            <SheetTitle>{editingId ? 'עריכת דיווח' : 'דיווח שעות'}</SheetTitle>
          </SheetHeader>
          <div className="py-3 space-y-3">
            {permittedClients.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                אין לקוחות מורשים לדיווח שעות. פנה למנהל.
              </p>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-purple-700">לקוח</Label>
                  <ClientPicker
                    value={clientId}
                    onChange={(id, c) => {
                      setClientId(id)
                      setClientName(c?.name ?? '')
                    }}
                    filter={(c) => permittedClients.some((p) => p.id === c.id)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">תאריך</Label>
                    <DateInput value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">משעה</Label>
                    <Input type="time" dir="ltr" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">עד שעה</Label>
                    <Input type="time" dir="ltr" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {computed != null ? `משך: ${computed} שעות` : 'בחר משעה ועד שעה'}
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">תיאור</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="תיאור קצר..."
                  />
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={saving || !clientId || !startTime || !endTime}
                    className="flex-1 h-12 bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {saving ? 'שומר...' : 'שמור'}
                  </Button>
                  <Button variant="outline" className="h-12" onClick={() => setSheetOpen(false)} disabled={saving}>
                    ביטול
                  </Button>
                </div>
                {!navigator.onLine && !editingId && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    המכשיר לא מחובר לאינטרנט — הדיווח ישמר מקומית ויסונכרן כשהחיבור יחזור.
                  </p>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
