import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

// Wraps a promise with a timeout. Rejects with a clear message if it takes
// longer than `ms` milliseconds — prevents the "שומר..." hang when the
// recovery session has expired or been consumed.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error('הקריאה לשרת לא הגיבה בזמן. ייתכן שקישור האיפוס פג תוקף — בקש קישור חדש.')),
        ms,
      ),
    ),
  ])
}

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
      const sp = new URLSearchParams(window.location.search)
      const pendingExchange =
        sp.has('code') ||
        sp.get('type') === 'recovery' ||
        window.location.hash.includes('type=recovery') ||
        window.sessionStorage.getItem('bhr_recovery_mode') === '1'
      if (pendingExchange) return // wait for PASSWORD_RECOVERY event
      navigate('/login', { replace: true })
      return
    }

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
      // 15-second timeout: if the recovery token has expired or been consumed
      // the updateUser call can hang indefinitely.
      // Retry once on auth-lock contention (Supabase client race condition):
      // "Lock 'lock:sb-...-auth-token' was released because another request stole it".
      let pwErr: Error | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const { error } = await withTimeout(
          supabase.auth.updateUser({ password }),
          15000,
        )
        if (!error) { pwErr = null; break }
        const isLock = error.message?.toLowerCase().includes('lock')
        if (isLock && attempt === 0) {
          await new Promise((r) => setTimeout(r, 600))
          continue // retry
        }
        pwErr = error
        break
      }

      if (pwErr) {
        if (
          pwErr.message.toLowerCase().includes('session') ||
          pwErr.message.toLowerCase().includes('expired') ||
          pwErr.message.toLowerCase().includes('invalid')
        ) {
          throw new Error('קישור האיפוס פג תוקף או כבר נוצל. בקש קישור חדש מהמנהל.')
        }
        throw pwErr
      }

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

  const sp = new URLSearchParams(window.location.search)
  const pendingExchange =
    !user && (
      sp.has('code') ||
      sp.get('type') === 'recovery' ||
      window.location.hash.includes('type=recovery') ||
      window.sessionStorage.getItem('bhr_recovery_mode') === '1'
    )

  if (loading || pendingExchange) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">מאמת קישור...</p>
      </div>
    )
  }
  if (!user) return null

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
