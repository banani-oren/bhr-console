import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

type AuthContextValue = {
  user: User | null
  profile: Profile | null
  loading: boolean
  /** True when the current session originated from a password-reset link.
   *  Components use this to force the user through /set-password even if
   *  profile.password_set is already true. Cleared on sign-out. */
  recoveryMode: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  // Detect recovery flow before render. The URL hash (#type=recovery) is
  // already consumed by the supabase client's detectSessionInUrl by the time
  // AuthProvider mounts, so the hash check alone is unreliable. supabase.ts
  // captures the flag synchronously at module-load time and persists it to
  // sessionStorage; we read both sources here.
  const [recoveryMode, setRecoveryMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    if (window.location.hash.includes('type=recovery')) return true
    try {
      return window.sessionStorage.getItem('bhr_recovery_mode') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    let cancelled = false
    let initialResolved = false

    // Batch 4.1 profile fix: when the Supabase auth row's email differs from
    // the cached profiles.email (i.e. the user completed an email-change
    // verification), reconcile the profile row so /users, /team, and the
    // sidebar reflect the new address.
    const syncProfileEmailIfStale = async (
      authUser: User,
      loadedProfile: Profile | null,
    ): Promise<Profile | null> => {
      if (!authUser.email || !loadedProfile) return loadedProfile
      if (loadedProfile.email === authUser.email) return loadedProfile
      const { data, error } = await supabase
        .from('profiles')
        .update({ email: authUser.email })
        .eq('id', authUser.id)
        .select('*')
        .single()
      if (error) {
        console.warn('could not reconcile profiles.email with auth.email', error)
        return loadedProfile
      }
      return (data as Profile | null) ?? loadedProfile
    }

    // 1. Prime the session synchronously from storage (or a short-lived
    //    background refresh for near-expiry tokens). getSession() reads the
    //    persisted session from localStorage and returns it WITHOUT a network
    //    round-trip in the normal case — exactly what we need to avoid the
    //    "no session → redirect to /login" flicker when a route changes.
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (data.session?.user) {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.session.user.id)
            .single()
          if (cancelled) return
          const reconciled = await syncProfileEmailIfStale(
            data.session.user,
            profileRow as Profile | null,
          )
          if (cancelled) return
          setUser(data.session.user)
          setProfile(reconciled)
        } else {
          setUser(null)
          setProfile(null)
        }
      } finally {
        if (!cancelled) {
          initialResolved = true
          setLoading(false)
        }
      }
    })()

    // 10s safety timeout — well above any normal latency, only trips if
    // getSession() above truly never resolves (network hang).
    const timeout = setTimeout(() => {
      if (!cancelled && !initialResolved) setLoading(false)
    }, 10000)

    // 2. Subscribe for subsequent auth state changes (sign-in / sign-out /
    //    token-refresh / password-recovery).
    //
    //    PASSWORD_RECOVERY must be handled even during the initial boot
    //    sequence (before initialResolved), because the Supabase SDK fires
    //    this event while getSession() is still in flight when the user
    //    arrives via a reset-password link.  All other events are still
    //    suppressed during init to avoid double-processing.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return

      if (event === 'PASSWORD_RECOVERY') {
        // Mark recovery mode so RequireRole and SetPassword can react.
        setRecoveryMode(true)
        if (session?.user) {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()
          if (cancelled) return
          const reconciled = await syncProfileEmailIfStale(
            session.user,
            profileRow as Profile | null,
          )
          if (cancelled) return
          setUser(session.user)
          setProfile(reconciled)
          // If getSession() hasn't resolved yet, complete initialisation now
          // so the loading spinner doesn't hang.
          if (!initialResolved) {
            initialResolved = true
            setLoading(false)
          }
        }
        return
      }

      // For all other events, let the initial getSession() resolution handle
      // the mount to avoid double-processing.
      if (!initialResolved) return

      if (session?.user) {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
        if (cancelled) return
        const reconciled = await syncProfileEmailIfStale(
          session.user,
          profileRow as Profile | null,
        )
        if (!cancelled) {
          setUser(session.user)
          setProfile(reconciled)
        }
      } else {
        if (!cancelled) {
          // Clear recovery mode whenever the session ends.
          setRecoveryMode(false)
          try { window.sessionStorage.removeItem('bhr_recovery_mode') } catch { /* ignore */ }
          setUser(null)
          setProfile(null)
        }
      }
    })

    return () => {
      cancelled = true
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string): Promise<void> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    // Don't manually set user/profile here — onAuthStateChange handles it
  }

  const signOut = async (): Promise<void> => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    // Don't manually clear state — onAuthStateChange handles it
  }

  const refreshProfile = async (): Promise<void> => {
    const { data: sessionData } = await supabase.auth.getSession()
    const currentUser = sessionData.session?.user ?? null
    if (!currentUser) {
      setProfile(null)
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single()
    if (error) {
      console.error('refreshProfile error', error)
      return
    }
    setProfile(data as Profile | null)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, recoveryMode, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
