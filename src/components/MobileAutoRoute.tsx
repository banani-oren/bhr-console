import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

// Detect mobile via UA + viewport width and auto-redirect to the /m
// landing page UNLESS the user has explicitly opted into desktop view.
// Override flag (`bhr_force_desktop=1`) is set when a user clicks
// "תצוגת דסקטופ" inside /m.
export default function MobileAutoRoute() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    if (!profile) return
    if (typeof window === 'undefined') return
    if (location.pathname.startsWith('/m')) return
    if (['/login', '/set-password'].includes(location.pathname)) return

    const ua = navigator.userAgent || ''
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(ua)
    const isNarrow = window.matchMedia?.('(max-width: 767px)').matches ?? false
    if (!isMobileUA && !isNarrow) return

    // Honor the explicit override.
    if (window.localStorage.getItem('bhr_force_desktop') === '1') return

    ran.current = true
    navigate('/m', { replace: true })
  }, [profile, navigate, location.pathname])

  return null
}
