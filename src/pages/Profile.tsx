import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { UserRole } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

const ROLE_LABELS_HE: Record<UserRole, string> = {
  admin: 'מנהל',
  administration: 'מנהלה',
  recruiter: 'רכז/ת גיוס',
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error'

export default function Profile() {
  const { user, profile, refreshProfile } = useAuth()
  const queryClient = useQueryClient()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? '')
      setPhone(profile.phone ?? '')
    }
  }, [profile])

  const updateProfile = useMutation({
    mutationFn: async (payload: { full_name: string; phone: string | null }) => {
      if (!profile) throw new Error('לא מחובר')
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: payload.full_name, phone: payload.phone })
        .eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await refreshProfile()
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    },
    onError: (err) => {
      console.error('profile update error', err)
      setSaveStatus('error')
    },
  })

  async function handleSave() {
    if (!fullName.trim()) return
    setSaveStatus('saving')
    try {
      await updateProfile.mutateAsync({
        full_name: fullName.trim(),
        phone: phone.trim() ? phone.trim() : null,
      })
    } catch {
      // handled by onError
    }
  }

  // Password change dialog
  const [pwOpen, setPwOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwStatus, setPwStatus] = useState<SaveStatus>('idle')
  const [pwError, setPwError] = useState<string | null>(null)

  function openPwDialog() {
    setNewPassword('')
    setConfirmPassword('')
    setPwStatus('idle')
    setPwError(null)
    setPwOpen(true)
  }

  async function handleChangePassword() {
    setPwError(null)
    if (newPassword.length < 8) {
      setPwError('הסיסמה חייבת להכיל לפחות 8 תווים')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('הסיסמאות אינן תואמות')
      return
    }
    setPwStatus('saving')
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwStatus('success')
      setTimeout(() => {
        setPwOpen(false)
        setPwStatus('idle')
      }, 1800)
    } catch (err) {
      console.error('password change error', err)
      setPwStatus('error')
      setPwError(err instanceof Error ? err.message : 'שגיאה בעדכון הסיסמה')
    }
  }

  if (!profile || !user) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-muted-foreground">טוען...</p>
      </div>
    )
  }

  return (
    <div dir="rtl" className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">הפרופיל שלי</h1>
        <Badge className="bg-purple-600 hover:bg-purple-700 text-white">
          {ROLE_LABELS_HE[profile.role]}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">פרטים אישיים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">אימייל</Label>
            <Input
              id="profile-email"
              value={user.email ?? ''}
              dir="ltr"
              disabled
              className="bg-muted/40"
            />
            <p className="text-[11px] text-muted-foreground">
              שינוי כתובת האימייל מחייב אימות נפרד — פנה לאדמין.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-name">שם מלא</Label>
            <Input
              id="profile-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-phone">טלפון</Label>
            <Input
              id="profile-phone"
              value={phone}
              dir="ltr"
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 pt-2">
            {saveStatus === 'success' && (
              <p className="text-green-600 font-medium text-sm">המידע נשמר ✓</p>
            )}
            {saveStatus === 'error' && (
              <p className="text-red-600 font-medium text-sm">שגיאה בשמירה, נסה שנית</p>
            )}
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={saveStatus === 'saving' || !fullName.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" onClick={openPwDialog}>
                שנה סיסמה
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={pwOpen} onOpenChange={(open) => { if (!open) setPwOpen(false) }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>שינוי סיסמה</DialogTitle>
          </DialogHeader>
          {pwStatus === 'success' ? (
            <div className="py-4">
              <p className="text-green-600 font-medium text-sm">הסיסמה עודכנה ✓</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">סיסמה חדשה</Label>
                <Input
                  id="new-password"
                  type="password"
                  dir="ltr"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">אימות סיסמה</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  dir="ltr"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {pwError && (
                <p className="text-sm text-destructive">{pwError}</p>
              )}
              <DialogFooter className="flex gap-2 flex-row-reverse">
                <Button
                  onClick={handleChangePassword}
                  disabled={pwStatus === 'saving'}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {pwStatus === 'saving' ? 'מעדכן...' : 'עדכן סיסמה'}
                </Button>
                <Button variant="outline" onClick={() => setPwOpen(false)}>
                  ביטול
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
