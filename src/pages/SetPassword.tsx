import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export default function SetPassword() {
  const { user, profile, loading, recoveryMode } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    // Only redirect away when the password is already set AND we are NOT in a
    // password-reset (recovery) flow.  If recoveryMode is true the user
    // arrived via a reset-password link and must go through the form even if
    // password_set is already true.
    if (profile?.password_set && !recoveryMode) {
      navigate('/', { replace: true })
    }
  }, [loading, user, profile, recoveryMode, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('הסיסמה חייבת להכיל לפחות 8 תווים')
      return
    }
    if (password !== confirm) {
      setError('הסיסמאות אינן תואמות')
      return
    }

    setSubmitting(true)
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password })
      if (pwErr) throw pwErr

      if (user) {
        const { error: profErr } = await supabase
          .from('profiles')
          .update({ password_set: true })
          .eq('id', user.id)
        if (profErr) throw profErr
      }

      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    } catch (err) {
      console.error('Set password error:', err)
      setError(err instanceof Error ? err.message : 'שגיאה בקביעת סיסמה')
      setSubmitting(false)
    }
  }

  if (loading || !user) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">טוען...</p>
      </div>
    )
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-background p-4"
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center gap-1">
          <CardTitle className="text-2xl font-bold tracking-tight">
            קביעת סיסמה
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            ברוכים הבאים ל-BHR Console. אנא בחרו סיסמה לחשבונכם.
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" method="post" action="#">
            {/* Batch 4 Phase D4: hidden username so Safari can associate the
                new password with the correct account in its Keychain. */}
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={user?.email ?? ''}
              readOnly
              hidden
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">סיסמה חדשה</Label>
              <Input
                id="password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="לפחות 8 תווים"
                disabled={submitting}
                dir="ltr"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm">אימות סיסמה</Label>
              <Input
                id="confirm"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="הזינו שוב"
                disabled={submitting}
                dir="ltr"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white border-transparent focus-visible:ring-purple-500/50"
            >
              {submitting ? 'שומר...' : 'קבע סיסמה והמשך להתחברות'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
