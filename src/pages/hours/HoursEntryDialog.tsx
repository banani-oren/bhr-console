import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useSafeMutation } from '@/hooks/useSafeMutation'
import type { Client, HoursLog } from '@/lib/types'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import ClientPicker from '@/components/ClientPicker'
import { DateInput } from '@/components/ui/date-input'
import { computeHours, todayIso } from './common'

type Mode = 'create' | 'edit'

export type HoursEntryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Predicate constraining which clients can be picked. */
  clientFilter: (c: Client) => boolean
  /** Optional pre-selected client (used when a client is chosen in the filter). */
  presetClientId?: string | null
  /** Display name for the preset client — shown as read-only locked text. */
  presetClientName?: string | null
  /** When editing, the row to load. Pass null to clear into create mode. */
  editing?: HoursLog | null
  /** Override the profile_id the row is written for. Defaults to auth.uid(). */
  profileIdOverride?: string | null
  /** React Query keys to invalidate on success. */
  invalidate?: Array<string | unknown[]>
}

export default function HoursEntryDialog({
  open,
  onOpenChange,
  clientFilter,
  presetClientId,
  presetClientName,
  editing,
  profileIdOverride,
  invalidate = [['hours_log']],
}: HoursEntryDialogProps) {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const isEdit = !!editing
  const mode: Mode = isEdit ? 'edit' : 'create'
  // Lock the client when it was preset from the filter (create mode only).
  const clientLocked = !isEdit && !!presetClientId

  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string>('')
  const [visitDate, setVisitDate] = useState(todayIso())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('')
  const [hours, setHours] = useState<string>('')
  const [description, setDescription] = useState('')

  // Reset form when the dialog opens.
  useEffect(() => {
    if (!open) return
    if (editing) {
      setClientId(editing.client_id ?? null)
      setClientName(editing.client_name ?? '')
      setVisitDate(editing.visit_date)
      setStartTime(editing.start_time ?? '09:00')
      setEndTime(editing.end_time ?? '')
      setHours(editing.hours != null ? String(editing.hours) : '')
      setDescription(editing.description ?? '')
    } else {
      setClientId(presetClientId ?? null)
      setClientName(presetClientName ?? '')
      setVisitDate(todayIso())
      setStartTime('09:00')
      setEndTime('')
      setHours('')
      setDescription('')
    }
  }, [open, editing, presetClientId, presetClientName])

  // Auto-calculate hours from the time range. The user can still override the
  // value afterwards by editing the hours field directly.
  useEffect(() => {
    if (!open) return
    if (startTime && endTime) {
      const computed = computeHours(startTime, endTime)
      if (computed > 0) setHours(String(computed))
    }
  }, [open, startTime, endTime])

  const mut = useSafeMutation<void, void>({
    timeoutMs: 10000,
    mutationFn: async (_args, signal) => {
      if (!clientId || !clientName) throw new Error('יש לבחור לקוח')
      const visit = new Date(visitDate)
      const ownerId = profileIdOverride ?? profile?.id
      if (!ownerId) throw new Error('משתמש לא מזוהה')
      const hoursValue = hours !== '' ? Number(hours) : computeHours(startTime, endTime)
      if (!hoursValue || Number.isNaN(hoursValue) || hoursValue <= 0) {
        throw new Error('יש להזין מספר שעות תקין')
      }
      const payload: Record<string, unknown> = {
        profile_id: ownerId,
        client_id: clientId,
        client_name: clientName,
        visit_date: visitDate,
        start_time: startTime || null,
        end_time: endTime || null,
        hours: hoursValue,
        description: description || null,
        month: visit.getMonth() + 1,
        year: visit.getFullYear(),
      }
      if (isEdit && editing) {
        const { error } = await supabase
          .from('hours_log')
          .update(payload)
          .eq('id', editing.id)
          .abortSignal(signal)
        if (error) throw error
      } else {
        const { error } = await supabase.from('hours_log').insert(payload).abortSignal(signal)
        if (error) throw error
      }
    },
    invalidate,
    successHoldMs: 1200,
    onSuccess: () => {
      // Manually invalidate the broad keys too (caller-passed list covers
      // their specific cache, but other views also benefit from a refresh).
      queryClient.invalidateQueries({ queryKey: ['hours_log'] })
      setTimeout(() => onOpenChange(false), 1200)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'עריכת דיווח' : 'דיווח שעות'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs text-purple-700">לקוח</Label>
            {clientLocked ? (
              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">
                {clientName || '—'}
              </div>
            ) : (
              <ClientPicker
                value={clientId}
                onChange={(id, c) => { setClientId(id); setClientName(c?.name ?? '') }}
                filter={clientFilter}
                placeholder="חפש לקוח..."
              />
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">תאריך</Label>
              <DateInput value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">משעה</Label>
              <Input
                type="time"
                dir="ltr"
                className="w-full min-w-[90px]"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">עד שעה</Label>
              <Input
                type="time"
                dir="ltr"
                className="w-full min-w-[90px]"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">שעות</Label>
              <Input
                type="number"
                step="0.25"
                min="0"
                dir="ltr"
                className="w-full"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            מתחשב אוטומטית מטווח השעות — ניתן לעדכן ידנית
          </p>
          <div className="space-y-1">
            <Label className="text-xs">תיאור</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="תיאור קצר..."
            />
          </div>
          {mut.saveStatus === 'error' && (
            <p className="text-sm text-destructive">{mut.errorMessage ?? 'שגיאה בשמירה'}</p>
          )}
          {mut.saveStatus === 'timeout' && (
            <p className="text-sm text-destructive">פג זמן השמירה. נסה שנית.</p>
          )}
          {mut.saveStatus === 'success' && (
            <p className="text-sm text-green-600">{mode === 'edit' ? 'עודכן ✓' : 'נשמר ✓'}</p>
          )}
        </div>
        <DialogFooter className="flex gap-2 flex-row-reverse">
          <Button
            disabled={mut.saveStatus === 'saving'}
            onClick={() => void mut.mutate()}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {mut.saveStatus === 'saving' ? 'שומר...' : mode === 'edit' ? 'עדכן' : 'שמור'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.saveStatus === 'saving'}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
