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

    const timeout = setTimeout(() => {
      if (!cancelled && !initialResolved) setLoading(false)
    }, 10000)

    // Loads the profile row (+ email reconciliation) for a signed-in user.
    // Must only ever be invoked OUTSIDE the onAuthStateChange callback (see
    // below) — supabase-js's GoTrueClient serializes auth operations behind
    // an internal lock, and the callback below is invoked WHILE that lock is
    // held. Awaiting another locked call (getSession, which every
    // supabase.from() request makes internally to attach the access token)
    // from inside the callback creates a circular wait: the outer operation
    // is awaiting the callback, and the callback is awaiting a call that
    // queues behind the outer operation. It deadlocks forever with the
    // request never even reaching the network (proven via runtime repro).
    const loadProfile = async (authUser: User) => {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single()
      if (cancelled) return
      const reconciled = await syncProfileEmailIfStale(
        authUser,
        profileRow as Profile | null,
      )
      if (cancelled) return
      setUser(authUser)
      setProfile(reconciled)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
        if (session?.user) {
          setUser(session.user)
          if (!initialResolved) {
            initialResolved = true
            setLoading(false)
          }
          // Remove the code/type params so they don't re-trigger recovery
          // detection on refresh.
          try {
            const clean = new URL(window.location.href)
            clean.searchParams.delete('code')
            clean.searchParams.delete('type')
            window.history.replaceState({}, '', clean.toString())
          } catch { /* ignore */ }
          // Deferred (see loadProfile comment above): runs after this
          // callback returns and the auth lock is released.
          setTimeout(() => {
            if (!cancelled) void loadProfile(session.user)
          }, 0)
        }
        return
      }

      if (!initialResolved) return

      if (session?.user) {
        setTimeout(() => {
          if (!cancelled) void loadProfile(session.user)
        }, 0)
      } else {
        setRecoveryMode(false)
        try { window.sessionStorage.removeItem('bhr_recovery_mode') } catch { /* ignore */ }
        setUser(null)
        setProfile(null)
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
  }

  const signOut = async (): Promise<void> => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
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
