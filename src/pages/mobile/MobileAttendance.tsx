import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { AttendanceLog } from '@/lib/types'
import { todayIsrael, formatTime, computeStatus, nextAction } from '@/lib/attendance'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function MobileAttendance() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const today = todayIsrael()

  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

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
    <div dir="rtl" className="p-4 space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">סטטוס נוכחי</p>
          <p className="text-lg font-semibold text-purple-900">{statusText}</p>
        </div>

        <Button
          onClick={handleCheck}
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
        {todayEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">אין דיווחים היום.</p>
        ) : (
          <ul className="space-y-1">
            {todayEntries.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-sm border-b last:border-0 py-1.5"
              >
                <span className="flex items-center gap-1.5">
                  {e.action === 'check_in' ? (
                    <LogIn className="h-4 w-4 text-green-600" />
                  ) : (
                    <LogOut className="h-4 w-4 text-orange-600" />
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
      </Card>
    </div>
  )
}
