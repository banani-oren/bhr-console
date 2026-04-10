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

export function useInsert<T>(table: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (row: Partial<T>) => {
      const { data, error } = await supabase.from(table).insert(row as any).select().single()
      if (error) throw error
      return data as T
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] })
    },
  })
}

export function useUpdate<T>(table: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<T> & { id: string }) => {
      const { data, error } = await supabase.from(table).update(updates as any).eq('id', id).select().single()
      if (error) throw error
      return data as T
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] })
    },
  })
}

export function useDelete(table: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] })
    },
  })
}
