import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Transaction } from '@/lib/types'

export function usePendingApprovals(enabled: boolean) {
  return useQuery<Transaction[]>({
    queryKey: ['pending_approvals'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('needs_approval', true)
        .is('approved_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Transaction[]
    },
  })
}
