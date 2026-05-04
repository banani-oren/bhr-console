import { createClient } from '@supabase/supabase-js'

// Capture the recovery-flow flag BEFORE createClient (with detectSessionInUrl)
// consumes and strips the URL hash. AuthProvider reads this to force the user
// through /set-password instead of dropping them into the app with an active
// recovery session. Cleared when the user signs out.
if (
  typeof window !== 'undefined' &&
  window.location.hash.includes('type=recovery')
) {
  try {
    window.sessionStorage.setItem('bhr_recovery_mode', '1')
  } catch {
    // sessionStorage may be blocked (e.g. private mode); fall back to the
    // PASSWORD_RECOVERY event subscriber in AuthProvider.
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
