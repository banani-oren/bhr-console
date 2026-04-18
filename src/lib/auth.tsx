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

  useEffect(() => {
    let cancelled = false
    let initialResolved = false

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
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.session.user.id)
            .single()
          if (cancelled) return
          setUser(data.session.user)
          setProfile(profile as Profile | null)
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
    //    token-refresh). Do NOT touch `loading` here — only the initial
    //    resolution above controls the loading flag. This prevents a
    //    transient null-session event from toggling loading back on and
    //    triggering a premature redirect.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return
      if (!initialResolved) return // let the initial resolution handle mount

      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
        if (!cancelled) {
          setUser(session.user)
          setProfile(profile as Profile | null)
        }
      } else {
        if (!cancelled) {
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
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, refreshProfile }}>
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
