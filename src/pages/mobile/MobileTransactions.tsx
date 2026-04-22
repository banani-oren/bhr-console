import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { Transaction } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/pdf'

export default function MobileTransactions() {
  const { profile } = useAuth()
  const { data: rows = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['m-transactions', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('entry_date', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as Transaction[]
    },
  })

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-lg font-semibold text-purple-900">משרות / עסקאות</h1>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">טוען...</p>
      ) : rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">אין עסקאות.</Card>
      ) : (
        rows.map((t) => (
          <Card key={t.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{t.client_name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {t.position_name || t.candidate_name || '—'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {t.close_date ?? t.entry_date ?? '—'}
                </p>
              </div>
              <div className="text-left shrink-0">
                {t.kind === 'time_period' ? (
                  <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">שעות</Badge>
                ) : (
                  <Badge className="bg-purple-50 text-purple-700 border-purple-200 text-[10px]">שירות</Badge>
                )}
                <p className="text-sm font-semibold mt-1">
                  {formatCurrency(Number(t.net_invoice_amount) || 0)}
                </p>
                <p className="text-[10px] text-muted-foreground">{t.payment_status}</p>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
