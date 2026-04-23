import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useSafeMutation } from '@/hooks/useSafeMutation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

// Shared profile editor used by /profile (desktop) and /m/profile (mobile).
// Renders a stacked column; callers decide width constraints.

type Variant = 'desktop' | 'mobile'

export default function ProfileEditor({ variant = 'desktop' }: { variant?: Variant }) {
  const { user, profile, refreshProfile } = useAuth()
  const queryClient = useQueryClient()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [pwOpen, setPwOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? '')
      setPhone(profile.phone ?? '')
    }
  }, [profile])

  const saveProfile = useSafeMutation<{ full_name: string; phone: string | null }, void>({
    mutationFn: async (payload) => {
      if (!profile) throw new Error('לא מחובר')
      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', profile.id)
      if (error) throw error
    },
    invalidate: [['profile'], ['profiles'], ['team-employees']],
    onSuccess: async () => {
      await refreshProfile()
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })

  const handleSave = () => {
    if (!fullName.trim()) return
    void saveProfile.mutate({
      full_name: fullName.trim(),
      phone: phone.trim() ? phone.trim() : null,
    })
  }

  const isMobile = variant === 'mobile'

  return (
    <div className={isMobile ? 'p-4 space-y-4' : 'space-y-6'}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">פרטים אישיים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">אימייל</Label>
            <div className="flex items-center gap-2">
              <Input
                id="profile-email"
                value={user?.email ?? ''}
                dir="ltr"
                disabled
                className="bg-muted/40 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setEmailOpen(true)}
                className="shrink-0"
              >
                שנה
              </Button>
            </div>
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
              inputMode="tel"
            />
          </div>

          <div className="flex flex-col gap-2 pt-2">
            {saveProfile.saveStatus === 'success' && (
              <p className="text-green-600 font-medium text-sm">המידע נשמר ✓</p>
            )}
            {saveProfile.saveStatus === 'error' && (
              <p className="text-red-600 font-medium text-sm">
                {saveProfile.errorMessage ?? 'שגיאה בשמירה, נסה שנית'}
              </p>
            )}
            {saveProfile.saveStatus === 'timeout' && (
              <p className="text-red-600 font-medium text-sm">פג זמן השמירה. נסה שנית.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleSave}
                disabled={saveProfile.saveStatus === 'saving' || !fullName.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saveProfile.saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" onClick={() => setPwOpen(true)}>
                שנה סיסמה
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      <ChangeEmailDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        currentEmail={user?.email ?? ''}
      />
    </div>
  )
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const mut = useSafeMutation<{ newPassword: string }, void>({
    mutationFn: async ({ newPassword }) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
    },
    successHoldMs: 1800,
    onSuccess: () => {
      setTimeout(() => {
        onOpenChange(false)
        setNewPassword('')
        setConfirm('')
      }, 1800)
    },
  })

  useEffect(() => {
    if (open) {
      setNewPassword('')
      setConfirm('')
      setLocalError(null)
      mut.resetStatus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    if (newPassword.length < 8) {
      setLocalError('הסיסמה חייבת להכיל לפחות 8 תווים')
      return
    }
    if (newPassword !== confirm) {
      setLocalError('הסיסמאות אינן תואמות')
      return
    }
    void mut.mutate({ newPassword })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>שינוי סיסמה</DialogTitle>
        </DialogHeader>
        {mut.saveStatus === 'success' ? (
          <div className="py-4">
            <p className="text-green-600 font-medium text-sm">הסיסמה עודכנה ✓</p>
            <p className="text-xs text-muted-foreground mt-1">בכניסה הבאה יש להזין את הסיסמה החדשה.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2" method="post" action="#">
            {/* Hidden username so Safari/Keychain associates the new password with this account */}
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={user?.email ?? ''}
              readOnly
              hidden
              aria-hidden="true"
            />
            <div className="space-y-1.5">
              <Label htmlFor="np-new">סיסמה חדשה</Label>
              <Input
                id="np-new"
                type="password"
                autoComplete="new-password"
                name="new-password"
                dir="ltr"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-confirm">אימות סיסמה</Label>
              <Input
                id="np-confirm"
                type="password"
                autoComplete="new-password"
                name="confirm-password"
                dir="ltr"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {localError && <p className="text-sm text-destructive">{localError}</p>}
            {mut.saveStatus === 'error' && (
              <p className="text-sm text-destructive">
                {mut.errorMessage ?? 'שגיאה בעדכון הסיסמה'}
              </p>
            )}
            {mut.saveStatus === 'timeout' && (
              <p className="text-sm text-destructive">פג זמן השמירה. נסה שנית.</p>
            )}
            <DialogFooter className="flex gap-2 flex-row-reverse">
              <Button
                type="submit"
                disabled={mut.saveStatus === 'saving'}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {mut.saveStatus === 'saving' ? 'מעדכן...' : 'עדכן סיסמה'}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                ביטול
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentEmail: string
}) {
  const [newEmail, setNewEmail] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const mut = useSafeMutation<{ newEmail: string }, string>({
    mutationFn: async ({ newEmail }) => {
      const { error } = await supabase.auth.updateUser({ email: newEmail })
      if (error) throw error
      return newEmail
    },
    successHoldMs: 3000,
    onSuccess: (email) => {
      setSentTo(email)
    },
  })

  useEffect(() => {
    if (open) {
      setNewEmail('')
      setLocalError(null)
      setSentTo(null)
      mut.resetStatus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    const trimmed = newEmail.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setLocalError('כתובת מייל לא תקינה')
      return
    }
    if (trimmed === currentEmail.toLowerCase()) {
      setLocalError('הכתובת החדשה זהה לכתובת הנוכחית')
      return
    }
    void mut.mutate({ newEmail: trimmed })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>שינוי כתובת מייל</DialogTitle>
        </DialogHeader>
        {mut.saveStatus === 'success' && sentTo ? (
          <div className="py-4 space-y-2">
            <p className="text-green-600 font-medium text-sm">קישור אימות נשלח ל-{sentTo}.</p>
            <p className="text-xs text-muted-foreground">
              יש לאשר בתיבת הדואר החדשה כדי להשלים את השינוי. עד האישור — המשך להיכנס עם הכתובת הקיימת.
            </p>
            <DialogFooter className="flex gap-2 flex-row-reverse pt-2">
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                סגור
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2" method="post" action="#">
            <div className="space-y-1.5">
              <Label>כתובת נוכחית</Label>
              <Input value={currentEmail} disabled dir="ltr" className="bg-muted/40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-new-email">כתובת חדשה</Label>
              <Input
                id="ce-new-email"
                type="email"
                name="new-email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                dir="ltr"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@example.com"
                required
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              נשלח קישור אימות לכתובת החדשה. שינוי המייל יושלם לאחר אימות.
            </p>
            {localError && <p className="text-sm text-destructive">{localError}</p>}
            {mut.saveStatus === 'error' && (
              <p className="text-sm text-destructive">
                {mut.errorMessage ?? 'שגיאה בעדכון המייל'}
              </p>
            )}
            {mut.saveStatus === 'timeout' && (
              <p className="text-sm text-destructive">פג זמן השמירה. נסה שנית.</p>
            )}
            <DialogFooter className="flex gap-2 flex-row-reverse">
              <Button
                type="submit"
                disabled={mut.saveStatus === 'saving'}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {mut.saveStatus === 'saving' ? 'שולח...' : 'שלח קישור אימות'}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                ביטול
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
