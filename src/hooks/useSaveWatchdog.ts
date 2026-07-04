import { useEffect, useRef } from 'react'

// Last-resort safety net: forces UI recovery if `saving` stays true longer
// than any of the app's own abort timeouts (10s) should ever allow.
export function useSaveWatchdog(
  saving: boolean,
  onTimeout: () => void,
  timeoutMs = 12000,
) {
  const cb = useRef(onTimeout)
  cb.current = onTimeout
  useEffect(() => {
    if (!saving) return
    const id = setTimeout(() => cb.current(), timeoutMs)
    return () => clearTimeout(id)
  }, [saving, timeoutMs])
}
