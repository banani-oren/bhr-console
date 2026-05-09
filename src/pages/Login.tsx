import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { DEFAULT_LANDING } from '@/components/RequireRole'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Share2, CheckCircle2 } from 'lucide-react'

// Batch 4 Phase D4: iOS Safari doesn't fire beforeinstallprompt. Nudge the
// user through the Share → Add to Home Screen flow when we detect iOS + we
// aren't already in standalone mode.
function IosInstallHint() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIos = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  const inStandalone =
    typeof window !== 'undefined' &&
    (
      (window.matchMedia?.('(display-mode: standalone)').matches) ||
      // @ts-expect-error legacy iOS navigator.standalone
      window.navigator?.standalone === true
    )
  if (!isIos || inStandalone) return null
  return (
    <p className="mt-4 text-[11px] text-center text-muted-foreground leading-relaxed">
      <Share2 className="inline h-3 w-3 mb-0.5" /> להוספה למסך הבית — לחץ "שתף" ואז "הוסף למסך הבית".
    </p>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'login' | 'forgot' | 'forgot-sent'>('login')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const { user, profile } = useAuth()

  if (user) {
    if (!profile?.password_set) {
      return <Navigate to="/set-password" replace />
    }
    return <Navigate to={DEFAULT_LANDING[profile.role]} replace />
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        console.error('Login error:', error)
        setError(error.message)
        setLoading(false)
        return
      }
      // On success: do NOT setLoading(false) here.
      // onAuthStateChange in auth.tsx fires, sets user state, and the `if (user)`
      // check above triggers <Navigate to="/" /> which unmounts this component.
      // Add a 10-second safety timeout to reset loading if redirect never happens:
      setTimeout(() => setLoading(false), 10000)
    } catch (err) {
      console.error('Login exception:', err)
      setError('שגיאה בהתחברות, נסה שנית')
      setLoading(false)
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setResetError('הזן כתובת מייל קודם')
      return
    }
    setResetLoading(true)
    setResetError(null)
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.banani-hr.com'
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/set-password`,
      })
      if (error) {
        console.error('reset error:', error)
        setResetError('שגיאה בשליחת המייל. ודא שהכתובת רשומה במערכת.')
      } else {
        setMode('forgot-sent')
      }
    } catch (err) {
      console.error('reset exception:', err)
      setResetError('שגיאה בשליחת המייל. נסה שוב מאוחר יותר.')
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-background p-4"
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center gap-1">
          <CardTitle className="text-2xl font-bold tracking-tight">
            BHR Console
          </CardTitle>
          <p className="text-sm text-muted-foreground">מערכת ניהול פיננסי</p>
        </CardHeader>

        <CardContent>
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="flex flex-col gap-4" method="post" action="#">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">אימייל</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={loading}
                  dir="ltr"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">סיסמה</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  dir="ltr"
                />
                <button
                  type="button"
                  className="text-xs text-purple-600 hover:underline mt-1 text-right w-full"
                  onClick={() => { setMode('forgot'); setResetError(null) }}
                >
                  שכחתי סיסמה?
                </button>
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white border-transparent focus-visible:ring-purple-500/50"
              >
                {loading ? 'מתחבר...' : 'התחבר'}
              </Button>
            </form>
          )}

          {mode === 'forgot' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                הזן את כתובת המייל שלך ונשלח לך קישור לאיפוס סיסמה.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-reset">אימייל</Label>
                <Input
                  id="email-reset"
                  type="email"
                  inputMode="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={resetLoading}
                  dir="ltr"
                />
              </div>
              {resetError && <p className="text-sm text-destructive">{resetError}</p>}
              <Button
                onClick={handleForgotPassword}
                disabled={resetLoading}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              >
                {resetLoading ? 'שולח...' : 'שלח קישור לאיפוס'}
              </Button>
              <button
                type="button"
                className="text-sm text-purple-600 hover:underline w-full text-center"
                onClick={() => { setMode('login'); setResetError(null) }}
              >
                חזור להתחברות
              </button>
            </div>
          )}

          {mode === 'forgot-sent' && (
            <div className="text-center space-y-3 py-4">
              <CheckCircle2 className="mx-auto w-10 h-10 text-green-500" />
              <p className="text-sm font-medium">נשלח מייל לאיפוס סיסמה</p>
              <p className="text-xs text-muted-foreground">
                בדוק את תיבת הדואר שלך ולחץ על הקישור במייל.
              </p>
              <button
                type="button"
                className="text-sm text-purple-600 hover:underline"
                onClick={() => setMode('login')}
              >
                חזור להתחברות
              </button>
            </div>
          )}
          <IosInstallHint />
        </CardContent>
      </Card>
    </div>
  )
}
