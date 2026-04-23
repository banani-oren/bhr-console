import { useEffect, useMemo, useState } from 'react'
import { DateInput } from '@/components/ui/date-input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, WifiOff, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Client, HoursLog as HoursLogType } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import ClientPicker from '@/components/ClientPicker'
import { enqueueHoursEntry, readQueue, removeFromQueue } from '@/lib/offlineQueue'

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

  const [sheetOpen, setSheetOpen] = useState(false)
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
    queryKey: ['m-hours_log', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - 14)
      const { data, error } = await supabase
        .from('hours_log')
        .select('*')
        .eq('profile_id', profile!.id)
        .gte('visit_date', since.toISOString().slice(0, 10))
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

  const computed = computeHours(startTime, endTime)

  const resetForm = () => {
    setClientId(null)
    setClientName('')
    setVisitDate(today())
    setStartTime('09:00')
    setEndTime('')
    setDescription('')
    setError(null)
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
      if (!navigator.onLine) {
        await enqueueHoursEntry(payload)
        await refreshPending()
        setSheetOpen(false)
        resetForm()
        return
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        const { error: insErr } = await supabase.from('hours_log').insert(payload)
        if (insErr) throw insErr
      } finally {
        clearTimeout(timeout)
      }
      queryClient.invalidateQueries({ queryKey: ['m-hours_log'] })
      queryClient.invalidateQueries({ queryKey: ['hours_log'] })
      setSheetOpen(false)
      resetForm()
    } catch (err) {
      // If we lost network mid-save, queue locally for retry.
      if (!navigator.onLine) {
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

  const flushQueue = async () => {
    if (!navigator.onLine) return
    const queue = await readQueue()
    let flushed = 0
    for (const item of queue) {
      const { error } = await supabase.from('hours_log').insert(item.payload)
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
    <div className="p-4 space-y-3">
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

      <Button
        onClick={() => setSheetOpen(true)}
        className="w-full h-14 text-base bg-purple-600 hover:bg-purple-700 text-white shadow-md"
      >
        <Plus className="h-5 w-5 ml-1" /> דווח שעות
      </Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="max-h-[92vh] overflow-y-auto" dir="rtl">
          <SheetHeader>
            <SheetTitle>דיווח שעות</SheetTitle>
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
                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {saving ? 'שומר...' : 'שמור'}
                  </Button>
                  <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
                    ביטול
                  </Button>
                </div>
                {!navigator.onLine && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    המכשיר לא מחובר לאינטרנט — הדיווח ישמר מקומית ויסונכרן כשהחיבור יחזור.
                  </p>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <div className="space-y-3">
        {groups.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            אין דיווחים בשבועיים האחרונים.
          </Card>
        ) : (
          groups.map(([date, rows]) => (
            <Card key={date} className="p-3 space-y-2">
              <p className="text-xs font-medium text-purple-700">{date}</p>
              <div className="space-y-1">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1">
                    <div>
                      <p className="font-medium">{r.client_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <span dir="ltr">
                          {(r.start_time ?? '—')} → {(r.end_time ?? '—')}
                        </span>
                        {r.description ? ` · ${r.description}` : ''}
                      </p>
                    </div>
                    <span className="text-purple-700 font-semibold text-sm">{r.hours} ש'</span>
                  </div>
                ))}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
