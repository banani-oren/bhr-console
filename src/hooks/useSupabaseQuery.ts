import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useTable<T>(table: string, options?: { orderBy?: string; ascending?: boolean }) {
  return useQuery<T[]>({
    queryKey: [table],
    queryFn: async () => {
      let query = supabase.from(table).select('*')
      if (options?.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? false })
      } else {
        query = query.order('created_at', { ascending: false })
      }
      const { data, error } = await query
      if (error) throw error
      return data as T[]
    },
  })
}

// Self-contained 10s abort: a hung insert/update/delete can never leave the
// caller's mutation pending forever. The controller is internal so no call
// site needs to pass a signal.
function withSaveTimeout<R>(work: (signal: AbortSignal) => Promise<R>): Promise<R> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 10000)
  return work(controller.signal).finally(() => clearTimeout(timer))
}

export function useInsert<T>(table: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (row: Partial<T>) =>
      withSaveTimeout(async (signal) => {
        const { data, error } = await supabase.from(table).insert(row as any).select().abortSignal(signal).single()
        if (error) throw error
        return data as T
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] })
    },
  })
}

export function useUpdate<T>(table: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<T> & { id: string }) =>
      withSaveTimeout(async (signal) => {
        const { data, error } = await supabase.from(table).update(updates as any).eq('id', id).select().abortSignal(signal).single()
        if (error) throw error
        return data as T
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] })
    },
  })
}

export function useDelete(table: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      withSaveTimeout(async (signal) => {
        const { error } = await supabase.from(table).delete().eq('id', id).abortSignal(signal)
        if (error) throw error
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] })
    },
  })
}
