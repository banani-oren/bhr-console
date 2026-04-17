import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase environment variables are not configured')
}

// Public (token-only) client for the employee portal.
// Does NOT read/write/refresh any auth session, so it cannot be blocked
// by a stale admin session sitting in localStorage.
// Uses a distinct storageKey to avoid the "Multiple GoTrueClient instances"
// warning when both clients share the same default key.
export const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'sb-szunbwkmldepkwpxojma-portal-public',
  },
})
