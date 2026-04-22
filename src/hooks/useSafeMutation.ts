import { useRef, useState } from 'react'
import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query'

// Batch 4 Phase A2: wraps useMutation with a hard timeout and a predictable
// save-state machine. Every save/update/delete in the app should use this so
// hung requests can never leave a dialog stuck on "שומר...".

export type SaveStatus = 'idle' | 'saving' | 'success' | 'error' | 'timeout'

type Params<TArgs, TResult> = {
  // The async function performing the actual work. It receives the caller's
  // args and an AbortSignal it MUST pass to any fetch() / network call so
  // the 15s timeout can interrupt stuck requests.
  mutationFn: (args: TArgs, signal: AbortSignal) => Promise<TResult>
  // React Query keys to invalidate on success.
  invalidate?: Array<string | unknown[]>
  // Invoked on success BEFORE the success state is broadcast (e.g. for dialog
  // close logic that needs the mutation result).
  onSuccess?: (result: TResult, args: TArgs) => void
  onError?: (err: unknown, args: TArgs) => void
  // Hard timeout in ms. Default 15000.
  timeoutMs?: number
  // How long to show the success state before auto-resetting to idle. Default 1500.
  successHoldMs?: number
} & Omit<UseMutationOptions<TResult, Error, TArgs>, 'mutationFn' | 'onSuccess' | 'onError'>

export type UseSafeMutationReturn<TArgs, TResult> = {
  mutate: (args: TArgs) => Promise<TResult | null>
  saveStatus: SaveStatus
  errorMessage: string | null
  resetStatus: () => void
  isSaving: boolean
}

export function useSafeMutation<TArgs = void, TResult = void>({
  mutationFn,
  invalidate = [],
  onSuccess,
  onError,
  timeoutMs = 15000,
  successHoldMs = 1500,
}: Params<TArgs, TResult>): UseSafeMutationReturn<TArgs, TResult> {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearResetTimer = () => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
  }

  const resetStatus = () => {
    clearResetTimer()
    setSaveStatus('idle')
    setErrorMessage(null)
  }

  const m = useMutation<TResult, Error, TArgs>({
    mutationFn: async (args) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), timeoutMs)
      try {
        return await mutationFn(args, controller.signal)
      } finally {
        clearTimeout(timer)
      }
    },
    onMutate: () => {
      clearResetTimer()
      setSaveStatus('saving')
      setErrorMessage(null)
    },
    onSuccess: (result, args) => {
      clearResetTimer()
      setSaveStatus('success')
      setErrorMessage(null)
      for (const key of invalidate) {
        queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] })
      }
      onSuccess?.(result, args)
      resetTimer.current = setTimeout(() => setSaveStatus('idle'), successHoldMs)
    },
    onError: (err, args) => {
      clearResetTimer()
      const msg = err instanceof Error ? err.message : String(err)
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      setSaveStatus(isAbort ? 'timeout' : 'error')
      setErrorMessage(isAbort ? 'פג זמן השמירה. נסה שנית.' : msg)
      console.error('useSafeMutation error:', err)
      onError?.(err, args)
    },
  })

  const mutate = async (args: TArgs) => {
    try {
      const res = await m.mutateAsync(args)
      return res ?? null
    } catch {
      return null
    }
  }

  return {
    mutate,
    saveStatus,
    errorMessage,
    resetStatus,
    isSaving: m.isPending,
  }
}
