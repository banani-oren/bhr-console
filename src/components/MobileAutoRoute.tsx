import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

// Batch 4 Phase D2: on first authenticated load, if the viewport is narrow
// (< 640 px) AND the caller isn't an admin AND they didn't land directly on
// an unauthenticated route, redirect to /m/hours. This runs exactly once per
// session so a desktop admin can still visit /m/* to preview.
export default function MobileAutoRoute() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    if (!profile) return
    if (profile.role === 'admin') return
    if (typeof window === 'undefined') return
    if (window.innerWidth >= 640) return
    if (location.pathname.startsWith('/m')) return
    if (['/login', '/set-password'].includes(location.pathname)) return
    ran.current = true
    navigate('/m/hours', { replace: true })
  }, [profile, navigate, location.pathname])

  return null
}
