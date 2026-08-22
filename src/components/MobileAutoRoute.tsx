import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useIsMobileDevice } from '@/hooks/useIsMobileDevice'

// Detect mobile via device UA/viewport+pointer and auto-redirect to the /m
// landing page. This is a hard lock, by design: it re-evaluates on every
// navigation (no one-shot guard) and has no opt-out (no bhr_force_desktop
// escape hatch) — a phone must never be able to sit on a desktop route.
export default function MobileAutoRoute() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobileDevice()

  useEffect(() => {
    try {
      window.localStorage.removeItem('bhr_force_desktop')
    } catch {
      // Safari private mode throws on localStorage access.
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    if (typeof window === 'undefined') return
    if (location.pathname.startsWith('/m')) return
    if (['/login', '/set-password'].includes(location.pathname)) return
    if (!isMobile) return

    navigate('/m', { replace: true })
  }, [profile, navigate, location.pathname, isMobile])

  return null
}
