import { useEffect, useState } from 'react'

const MOBILE_UA = /Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i

/**
 * True when the app is running on a real mobile device.
 *
 * Two independent signals, either of which is sufficient:
 *  - a mobile user-agent, or
 *  - a narrow viewport AND a coarse pointer (a touch device)
 *
 * The coarse-pointer condition on the viewport branch deliberately prevents a
 * desktop browser that happens to be resized narrow from being locked into the
 * mobile app with no way out — the mobile lock has no escape hatch by design
 * (see Phase 1), so the trigger must not fire on a mouse-driven desktop.
 *
 * Reactive: re-evaluates on resize and orientation change.
 */
export function detectMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (MOBILE_UA.test(ua)) return true
  const narrow = window.matchMedia?.('(max-width: 767px)').matches ?? false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return narrow && coarse
}

export function useIsMobileDevice(): boolean {
  const [isMobile, setIsMobile] = useState(detectMobileDevice)

  useEffect(() => {
    const update = () => setIsMobile(detectMobileDevice())
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return isMobile
}
