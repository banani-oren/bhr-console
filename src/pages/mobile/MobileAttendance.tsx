import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { AttendanceLog } from '@/lib/types'
import {
  todayIsrael,
  formatTime,
  computeStatus,
  nextAction,
  dayPairs,
  formatHours,
} from '@/lib/attendance'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function MobileAttendance() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const today = todayIsrael()

  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [checkoutNote, setCheckoutNote] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)

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

  // Phase 1: checking out shows the note input first; check-in saves immediately.
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
    const { error } = await supabase.from('attendance_log').insert(payload)
    setSaving(false)
    setShowNoteInput(false)
    setCheckoutNote('')
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
    <div dir="rtl" className="p-4 space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">סטטוס נוכחי</p>
          <p className="text-lg font-semibold text-purple-900">{statusText}</p>
        </div>

        {showNoteInput ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-center text-purple-800">מה עשית היום?</p>
            <input
              type="text"
              className="w-full border rounded-md px-3 py-3 text-sm"
              placeholder="תיאור קצר (אופציונלי, עד 250 תווים)"
              maxLength={250}
              value={checkoutNote}
              onChange={(e) => setCheckoutNote(e.target.value)}
              autoFocus
              dir="rtl"
            />
            <Button onClick={() => void handleCheck(checkoutNote)} disabled={saving}
              className="w-full h-14 bg-orange-600 hover:bg-orange-700 text-white text-base">
              <LogOut className="h-5 w-5 ml-1" /> {saving ? 'שומר...' : 'שמור יציאה'}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => { setShowNoteInput(false); setCheckoutNote('') }}>
              ביטול
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleCheckButtonClick}
            disabled={saving}
            className={
              action === 'check_in'
                ? 'w-full h-16 text-lg bg-green-600 hover:bg-green-700 text-white shadow-md'
                : 'w-full h-16 text-lg bg-orange-600 hover:bg-orange-700 text-white shadow-md'
            }
          >
            {action === 'check_in' ? (
              <>
                <LogIn className="h-6 w-6 ml-1" /> כניסה
              </>
            ) : (
              <>
                <LogOut className="h-6 w-6 ml-1" /> יציאה
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
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-medium text-purple-700">הדיווחים שלי היום</p>
        {(() => {
          const pairs = dayPairs(todayEntries)
          if (pairs.length === 0)
            return <p className="text-xs text-muted-foreground">אין דיווחים היום.</p>
          return (
            <ul className="space-y-2">
              {pairs.map((pair) => (
                <li key={pair.inEntry.id} className="border rounded-md p-2 space-y-1 bg-muted/20">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-green-700">
                      <LogIn className="h-4 w-4" />
                      <span dir="ltr">{formatTime(pair.inEntry.logged_at)}</span>
                    </span>
                    <span className="text-muted-foreground text-xs mx-1">→</span>
                    {pair.outEntry ? (
                      <span className="flex items-center gap-1 text-orange-700">
                        <LogOut className="h-4 w-4" />
                        <span dir="ltr">{formatTime(pair.outEntry.logged_at)}</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 text-xs">פתוח</span>
                    )}
                    <span className="text-purple-800 font-semibold text-xs mr-auto">
                      {pair.open ? '' : formatHours(pair.hours) + 'ש\''}
                    </span>
                  </div>
                  {pair.outEntry?.notes && (
                    <p className="text-xs text-muted-foreground truncate">{pair.outEntry.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          )
        })()}
      </Card>
    </div>
  )
}
