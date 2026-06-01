import { createClient } from '@supabase/supabase-js'

// Capture the recovery-flow flag BEFORE createClient (with detectSessionInUrl)
// consumes and strips the URL hash. AuthProvider reads this to force the user
// through /set-password instead of dropping them into the app with an active
// recovery session. Cleared when the user signs out.
if (typeof window !== 'undefined') {
  // Recovery links can arrive two ways:
  //  - legacy implicit flow → #type=recovery in the hash
  //  - PKCE flow → ?code=... (or ?type=recovery) in the query string
  // detectSessionInUrl consumes/strips these once createClient runs, so we
  // capture the flag synchronously here, before the client is constructed.
  const isRecoveryHash = window.location.hash.includes('type=recovery')
  const sp = new URLSearchParams(window.location.search)
  const isRecoveryQuery = sp.get('type') === 'recovery' || sp.has('code')

  if (isRecoveryHash || isRecoveryQuery) {
    try {
      window.sessionStorage.setItem('bhr_recovery_mode', '1')
    } catch {
      // sessionStorage may be blocked (e.g. private mode); fall back to the
      // PASSWORD_RECOVERY event subscriber in AuthProvider.
    }
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing Supabase environment variables. ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.',
    { url: !!supabaseUrl, key: !!supabaseAnonKey },
  )
  throw new Error('Supabase environment variables are not configured')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
